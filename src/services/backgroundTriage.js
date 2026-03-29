// Background Triage Orchestrator
// In background mode: returns streams immediately to Stremio, then runs health checks
// in the background. As NZBs pass verification, they are queued to NZBDav via the
// auto-advance queue. The Smart Play stream waits for the first ready NZB.
//
// Usage in server.js:
//   const bgSession = backgroundTriage.start(contentKey, candidates, triageOptions, nzbdavOptions);
//   // Smart Play endpoint:
//   const readySlot = await bgSession.waitForReady(240000);

const { triageAndRank } = require('./triage/runner');
const autoAdvanceQueue = require('./autoAdvanceQueue');

const TRIAGE_BATCH_DELAY_MS = 500;
const DEFAULT_MAX_EVALUATE = 12;
const MAX_CONSECUTIVE_FAILED_BATCHES = 3; // bail if N batches in a row produce 0 health checks

// Transient statuses that can be retried in a later batch
const TRANSIENT_STATUSES = new Set(['error', 'fetch-error', 'pending', 'unverified']);
// Permanent statuses that should never be retried
const PERMANENT_STATUSES = new Set(['verified', 'unverified_7z', 'blocked', 'skipped']);

// Active background triage sessions
const backgroundSessions = new Map();

/**
 * Start a background triage+queue session for a content request.
 *
 * @param {string} contentKey - Unique key (e.g., "movie:tt1234567")
 * @param {Array} candidates - All ranked NZB results (full pool from search)
 * @param {object} triageOptions - Options for triageAndRank() (NNTP config, indexer filters, etc.)
 * @param {object} nzbdavOptions - Options for NZBDav queueing
 * @param {function} nzbdavOptions.queueToNzbdav - async (candidate) => slot data
 * @param {function} nzbdavOptions.getCachedEntry - (downloadUrl) => cachedEntry | null
 * @param {string} nzbdavOptions.category - NZBDav category (Movies/Tv)
 * @param {object} [nzbdavOptions.requestedEpisode] - Episode info for series
 * @param {function} [nzbdavOptions.onDecision] - Called for each triage decision: (downloadUrl, decision) => void
 * @returns {BackgroundTriageSession}
 */
function start(contentKey, candidates, triageOptions, nzbdavOptions = {}) {
  // Close existing session for this key
  const existing = backgroundSessions.get(contentKey);
  if (existing) {
    existing.close();
  }

  const session = new BackgroundTriageSession(contentKey, candidates, triageOptions, nzbdavOptions);
  backgroundSessions.set(contentKey, session);
  session.runPromise = session.run(); // fire and forget, but promise available for callers
  return session;
}

function getSession(contentKey) {
  const session = backgroundSessions.get(contentKey);
  if (!session) return null;
  if (session.closed) {
    backgroundSessions.delete(contentKey);
    return null;
  }
  return session;
}

function closeSession(contentKey) {
  const session = backgroundSessions.get(contentKey);
  if (session) {
    session.close();
    backgroundSessions.delete(contentKey);
  }
}

class BackgroundTriageSession {
  constructor(contentKey, candidates, triageOptions, nzbdavOptions) {
    this.contentKey = contentKey;
    this.allCandidates = candidates.slice();
    this.triageOptions = triageOptions;
    this.nzbdavOptions = nzbdavOptions;
    this.onDecision = nzbdavOptions.onDecision || null;

    // Batch sizing
    this.batchSize = nzbdavOptions.initialBatchSize || 6;
    this.maxEvaluate = nzbdavOptions.maxEvaluate || DEFAULT_MAX_EVALUATE;

    // Triage results
    this.decisions = new Map(); // downloadUrl → decision
    this.verifiedUrls = [];     // Ordered list of verified download URLs
    this.blockedUrls = new Set();

    // Auto-advance queue session (created once we have verified candidates)
    this.autoAdvanceSession = null;
    this.closed = false;
    this.triageComplete = false;
    this.selectionReady = false; // Set after first pass (before retries) when verified NZBs are available for top-ranked selection
    this.createdAt = Date.now();
    this.triageElapsedMs = 0;

    // Stats
    this.evaluated = 0;        // total decisions received (including fetch-errors)
    this.healthChecked = 0;    // only real NNTP health checks (verified/blocked/unverified)
    this.totalCandidates = candidates.length;

    // In-memory cache of downloaded NZB payloads to avoid re-downloading on retries
    this.nzbPayloadCache = new Map();

    // Mounted candidates: NZBs already completed in NZBDav, excluded from health checks
    // but preserved for Smart Play selection. Populated from nzbdavOptions.completedCandidates.
    this.completedCandidates = Array.isArray(nzbdavOptions.completedCandidates)
      ? nzbdavOptions.completedCandidates.slice()
      : [];

    // Per-session suppression: mounted candidates that failed playback this session.
    this.failedMountedUrls = new Set();

    // Rank map: downloadUrl → original finalNzbResults index (lower index = better rank).
    // Falls back to position in allCandidates if not provided.
    this.rankByUrl = nzbdavOptions.rankByUrl instanceof Map
      ? new Map(nzbdavOptions.rankByUrl)
      : null;
  }

  /**
   * Wait for the first ready-to-play NZB. Delegates to the auto-advance queue.
   * If no auto-advance session yet (triage still running), waits for one to be created.
   *
   * In top-ranked mode, waits for triage to complete before activating the pipeline
   * so we can prioritize the highest-ranked verified NZB by original sort order.
   */
  async waitForReady(timeoutMs = 240000) {
    const deadline = Date.now() + timeoutMs;
    const smartPlayMode = this.nzbdavOptions.smartPlayMode || 'fastest';

    // Wait for auto-advance session to exist
    while (!this.autoAdvanceSession && !this.closed && Date.now() < deadline) {
      // If triage is done and nothing was verified, fail immediately
      if (this.triageComplete && this.verifiedUrls.length === 0) {
        throw new Error(`All ${this.blockedUrls.size} NZB candidates failed health check — none are playable`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (this.closed && !this.autoAdvanceSession) {
      throw new Error('Background triage session closed before any NZB was verified');
    }

    if (!this.autoAdvanceSession) {
      throw new Error('Timed out waiting for health check to verify an NZB');
    }

    // Top-ranked mode: wait for selectionReady (first pass done, before retries)
    // so we pick the best-ranked verified NZB without waiting for slow retries.
    if (smartPlayMode === 'top-ranked' && !this.selectionReady && !this.autoAdvanceSession.activated) {
      console.log(`[BG-TRIAGE] Top-ranked mode — waiting for first-pass selection to be ready`);
      while (!this.selectionReady && !this.closed && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (this.verifiedUrls.length > 0 && !this.autoAdvanceSession.activated) {
        const bestCandidate = this.getBestVerified();
        if (bestCandidate) {
          this.autoAdvanceSession.prioritizeCandidate(bestCandidate.downloadUrl);
          console.log(`[BG-TRIAGE] Top-ranked mode — prioritized: ${bestCandidate.title}`);
        }
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Timed out waiting for a ready NZB');
    }

    return this.autoAdvanceSession.waitForReady(remaining);
  }

  /**
   * Non-blocking peek: returns the first ready slot data or null.
   * Does NOT activate the pipeline, wait, or trigger any side effects.
   */
  peekReady() {
    if (this.autoAdvanceSession) {
      return this.autoAdvanceSession.peekReady();
    }
    return null;
  }

  /**
   * Get the triage status of a candidate by download URL.
   * Returns 'blocked', 'verified', etc. or null if not found.
   */
  getTriageStatus(downloadUrl) {
    const decision = this.decisions.get(downloadUrl);
    return decision?.status || null;
  }

  /**
   * Get the best verified candidate by original sort order.
   * Returns the candidate object or null if no verified candidates exist.
   */
  getBestVerified() {
    if (this.verifiedUrls.length === 0) return null;
    // verifiedUrls are in triage-completion order; pick the one with the
    // lowest rank in the original finalNzbResults sort order.
    let bestCandidate = null;
    let bestRank = Infinity;
    for (const url of this.verifiedUrls) {
      const rank = this._getRank(url);
      if (rank < bestRank) {
        bestRank = rank;
        bestCandidate = this.allCandidates.find((c) => c.downloadUrl === url) || null;
      }
    }
    return bestCandidate;
  }

  /**
   * Get the best (highest-ranked) candidate from the triage pool regardless of
   * whether it has been verified yet. Used by top-ranked mode for the first
   * immediate decision gate before waiting on verification.
   */
  getBestTriageCandidate() {
    if (this.allCandidates.length === 0) return null;
    let bestCandidate = null;
    let bestRank = Infinity;
    for (const candidate of this.allCandidates) {
      if (!candidate || !candidate.downloadUrl) continue;
      const rank = this._getRank(candidate.downloadUrl);
      if (rank < bestRank) {
        bestRank = rank;
        bestCandidate = candidate;
      }
    }
    return bestCandidate;
  }

  /**
   * Rank of the best triage-pool candidate. Infinity when triage pool is empty.
   */
  getBestTriageRank() {
    const best = this.getBestTriageCandidate();
    return best ? this._getRank(best.downloadUrl) : Infinity;
  }

  /**
   * Internal: get the original rank of a candidate by download URL.
   * Lower number = better rank (rank 0 = top result).
   * Uses rankByUrl map if available, then falls back to position in allCandidates/completedCandidates.
   */
  _getRank(downloadUrl) {
    if (!downloadUrl) return Infinity;
    if (this.rankByUrl) {
      const r = this.rankByUrl.get(downloadUrl);
      if (Number.isFinite(r)) return r;
    }
    // Fallback: triage pool candidates
    const idx = this.allCandidates.findIndex((c) => c.downloadUrl === downloadUrl);
    if (idx !== -1) return idx;
    // Then completed/mounted candidates (offset so they sort after triage pool)
    const cidx = this.completedCandidates.findIndex((c) => c.downloadUrl === downloadUrl);
    if (cidx !== -1) return this.allCandidates.length + cidx;
    return Infinity;
  }

  /**
   * Get the best candidate already completed in NZBDav by original result rank.
   * Skips candidates suppressed via markMountedFailed() this session.
   * Returns the candidate object or null.
   */
  getBestMountedCandidate() {
    if (this.completedCandidates.length === 0) return null;
    let best = null;
    let bestRank = Infinity;
    for (const candidate of this.completedCandidates) {
      if (!candidate || !candidate.downloadUrl) continue;
      if (this.failedMountedUrls.has(candidate.downloadUrl)) continue;
      const rank = this._getRank(candidate.downloadUrl);
      if (rank < bestRank) {
        bestRank = rank;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Get the best candidate to play right now, mode-aware.
   *   fastest    → mounted always wins if available (speed over quality)
   *   top-ranked → compare mounted and verified by rank; lower rank index wins
   * Returns { source: 'mounted'|'verified'|null, candidate, rank, bestMounted, bestVerified }
   */
  getBestPlayableCandidate(mode = 'top-ranked') {
    const bestMounted = this.getBestMountedCandidate();
    const bestVerified = this.getBestVerified();
    const mountedRank = bestMounted ? this._getRank(bestMounted.downloadUrl) : Infinity;
    const verifiedRank = bestVerified ? this._getRank(bestVerified.downloadUrl) : Infinity;

    if (mode === 'fastest') {
      if (bestMounted) {
        return { source: 'mounted', candidate: bestMounted, rank: mountedRank, bestMounted, bestVerified };
      }
      if (bestVerified) {
        return { source: 'verified', candidate: bestVerified, rank: verifiedRank, bestMounted, bestVerified };
      }
      return { source: null, candidate: null, rank: Infinity, bestMounted, bestVerified };
    }

    // top-ranked: lower rank index wins
    if (!bestMounted && !bestVerified) {
      return { source: null, candidate: null, rank: Infinity, bestMounted, bestVerified };
    }
    if (mountedRank <= verifiedRank) {
      return { source: 'mounted', candidate: bestMounted, rank: mountedRank, bestMounted, bestVerified };
    }
    return { source: 'verified', candidate: bestVerified, rank: verifiedRank, bestMounted, bestVerified };
  }

  /**
   * Get the best candidate already completed in NZBDav (instant playback).
   * Now delegates to getBestMountedCandidate() which uses completedCandidates,
   * not the triage pool — fixing the bug where completed files were ignored.
   */
  getInstantCandidate() {
    return this.getBestMountedCandidate();
  }

  /**
   * Suppress a mounted candidate for the rest of this session so it is not
   * selected again after a failed playback attempt.
   */
  markMountedFailed(downloadUrl) {
    if (downloadUrl) this.failedMountedUrls.add(downloadUrl);
  }

  /**
   * Mark a URL as failed in the auto-advance queue — triggers next backup.
   */
  markFailed(downloadUrl) {
    if (this.autoAdvanceSession) {
      this.autoAdvanceSession.markFailed(downloadUrl);
    }
  }

  /**
   * Get current triage progress.
   */
  getProgress() {
    return {
      evaluated: this.evaluated,
      healthChecked: this.healthChecked,
      total: this.totalCandidates,
      verified: this.verifiedUrls.length,
      blocked: this.blockedUrls.size,
      mountedCandidates: this.completedCandidates.length,
      failedMounted: this.failedMountedUrls.size,
      triageComplete: this.triageComplete,
      triageElapsedMs: this.triageElapsedMs,
      autoAdvanceReady: this.autoAdvanceSession ? this.autoAdvanceSession.activeCount : 0,
      closed: this.closed,
    };
  }

  close() {
    this.closed = true;
    if (this.autoAdvanceSession) {
      this.autoAdvanceSession.close();
    }
  }

  // --- Internal: Run triage in background ---

  // Statuses that represent a real NNTP health check (not a download/fetch issue)
  static HEALTH_CHECK_STATUSES = new Set(['verified', 'unverified_7z', 'blocked']);

  async run() {
    const startTs = Date.now();
    const cursor = { index: 0 };
    const retryQueue = [];
    let consecutiveFailedBatches = 0;

    try {
      // --- Phase 1: Process batches until we find verified NZBs or exhaust budget ---
      while (!this.closed && this.healthChecked < this.maxEvaluate) {
        const batch = this._buildNextBatch(cursor, retryQueue);
        if (batch.length === 0) break;

        console.log(`[BG-TRIAGE] Batch of ${batch.length} (health-checked=${this.healthChecked}/${this.maxEvaluate}, verified=${this.verifiedUrls.length}, cursor=${cursor.index}/${this.allCandidates.length})`);

        let batchVerified = 0;
        let batchHealthChecked = 0;
        const batchRetries = [];

        const streamingOnDecision = (url, decision) => {
          this.evaluated++;
          if (this.onDecision) {
            try { this.onDecision(url, decision); } catch { /* ignore */ }
          }

          const status = String(decision?.status || '').toLowerCase();

          if (BackgroundTriageSession.HEALTH_CHECK_STATUSES.has(status)) {
            // Real NNTP health check — counts toward budget
            this.healthChecked++;
            batchHealthChecked++;
          }

          if (status === 'verified' || status === 'unverified_7z') {
            this.decisions.set(url, decision);
            this.verifiedUrls.push(url);
            this._addVerifiedToAutoAdvance(url);
            batchVerified++;
          } else if (status === 'blocked') {
            this.decisions.set(url, decision);
            this.blockedUrls.add(url);
          } else if (TRANSIENT_STATUSES.has(status)) {
            // Transient failure (fetch-error, timeout, etc.) — does NOT count toward budget
            const prevDecision = this.decisions.get(url);
            const alreadyRetried = prevDecision && prevDecision._retried;
            this.decisions.set(url, { ...decision, _retried: alreadyRetried });
            if (!alreadyRetried) {
              const candidate = this.allCandidates.find((c) => c.downloadUrl === url)
                || batch.find((c) => c.downloadUrl === url);
              if (candidate) {
                batchRetries.push(candidate);
              }
            } else {
              this.blockedUrls.add(url);
              console.log(`[BG-TRIAGE] Retry failed (${status}): ${decision.title || url}`);
            }
          } else {
            this.decisions.set(url, decision);
          }
        };

        try {
          await triageAndRank(batch, {
            ...this.triageOptions,
            maxCandidates: batch.length,
            downloadConcurrency: Math.min(batch.length, this.triageOptions.downloadConcurrency || 8),
            onDecision: streamingOnDecision,
            nzbPayloadCache: this.nzbPayloadCache,
          });
          if (this.closed) break;
        } catch (err) {
          console.warn(`[BG-TRIAGE] Batch failed: ${err.message}`);
        }

        console.log(`[BG-TRIAGE] Batch done: ${batchVerified} verified, ${batchRetries.length} transient-failed, health-checked=${this.healthChecked}`);

        // Track consecutive batches with zero real health checks (all fetch-errors)
        if (batchHealthChecked === 0) {
          consecutiveFailedBatches++;
          if (consecutiveFailedBatches >= MAX_CONSECUTIVE_FAILED_BATCHES) {
            console.warn(`[BG-TRIAGE] ${consecutiveFailedBatches} consecutive batches with 0 health checks — all indexers appear down, stopping`);
            break;
          }
        } else {
          consecutiveFailedBatches = 0;
        }

        // --- Phase 2: If we have verified results, mark selection ready, then retry ---
        if (this.verifiedUrls.length > 0) {
          // Signal that top-ranked selection can proceed — don't wait for retries
          if (!this.selectionReady) {
            this.selectionReady = true;
            console.log(`[BG-TRIAGE] Selection ready: ${this.verifiedUrls.length} verified from first pass for ${this.contentKey}`);
          }
          if (batchRetries.length > 0 && !this.closed) {
            console.log(`[BG-TRIAGE] Retrying ${batchRetries.length} transient failures from this batch`);
            for (const c of batchRetries) {
              const existing = this.decisions.get(c.downloadUrl);
              if (existing) existing._retried = true;
            }
            try {
              await triageAndRank(batchRetries, {
                ...this.triageOptions,
                maxCandidates: batchRetries.length,
                downloadConcurrency: Math.min(batchRetries.length, this.triageOptions.downloadConcurrency || 8),
                onDecision: streamingOnDecision,
                nzbPayloadCache: this.nzbPayloadCache,
              });
            } catch (err) {
              console.warn(`[BG-TRIAGE] Retry batch failed: ${err.message}`);
            }
          }
          break; // Done — we have verified NZBs, no need to expand further
        }

        // --- Phase 3: No verified yet — queue retries for next batch, auto-expand ---
        // Always queue transient retries so each NZB gets exactly one retry attempt.
        // The consecutiveFailedBatches >= MAX check above already aborts when indexers are truly down.
        retryQueue.push(...batchRetries);
        if (batchRetries.length > 0) {
          console.log(`[BG-TRIAGE] ${batchRetries.length} transient failures queued for retry in next batch`);
        }

        // Small delay before trying the next batch
        if (!this.closed) {
          await new Promise((resolve) => setTimeout(resolve, TRIAGE_BATCH_DELAY_MS));
        }
      }
    } catch (err) {
      console.error('[BG-TRIAGE] Background triage crashed:', err.message);
    }

    this.triageComplete = true;
    this.triageElapsedMs = Date.now() - startTs;

    console.log(`[BG-TRIAGE] Complete for ${this.contentKey}: ${this.verifiedUrls.length} verified, ${this.blockedUrls.size} blocked, ${this.healthChecked} health-checked, ${this.evaluated} total in ${this.triageElapsedMs}ms`);

    if (this.verifiedUrls.length === 0 && !this.closed) {
      console.warn(`[BG-TRIAGE] No verified NZBs found for ${this.contentKey} after ${this.healthChecked} health checks — Smart Play will show failure video`);
    }

    // Pre-queue logic depends on prefetch and smart play mode:
    //   fastest  + prefetch ON  → activate immediately (queue first verified)
    //   top-ranked + prefetch ON → activate now (triage is done, best verified is known)
    //   prefetch OFF             → do nothing, Smart Play queues on-demand when clicked
    const prefetchEnabled = this.nzbdavOptions.prefetchEnabled;
    const smartPlayMode = this.nzbdavOptions.smartPlayMode || 'fastest';

    // Mark selectionReady if not already set (covers edge case of 0 verified after all batches)
    if (!this.selectionReady && this.verifiedUrls.length > 0) {
      this.selectionReady = true;
    }

    if (prefetchEnabled && this.autoAdvanceSession && this.verifiedUrls.length > 0 && !this.autoAdvanceSession.activated) {
      const bestMounted = this.getBestMountedCandidate();
      const mountedRank = bestMounted ? this._getRank(bestMounted.downloadUrl) : Infinity;

      if (smartPlayMode === 'fastest' && bestMounted) {
        // Fastest mode: mounted candidate exists — user will get it instantly on click.
        // No need to waste a NZBDav slot downloading a verified NZB in the background.
        console.log(`[BG-TRIAGE] Fastest prefetch skipped — mounted candidate already available (rank=${mountedRank}): ${bestMounted.title}`);
      } else {
        const bestVerified = this.getBestVerified();
        if (bestVerified) {
          const verifiedRank = this._getRank(bestVerified.downloadUrl);
          if (smartPlayMode === 'top-ranked' && mountedRank <= verifiedRank) {
            // Top-ranked: mounted outranks or ties the best verified — skip prefetch,
            // user will get the mounted file instantly on click.
            console.log(`[BG-TRIAGE] Top-ranked prefetch skipped — mounted (rank=${mountedRank}) beats or ties verified (rank=${verifiedRank}): ${bestMounted.title}`);
          } else {
            // Verified wins (or no mounted candidate) — prefetch it.
            if (smartPlayMode === 'top-ranked') {
              this.autoAdvanceSession.prioritizeCandidate(bestVerified.downloadUrl);
              console.log(`[BG-TRIAGE] Top-ranked prefetch: mounted-rank=${mountedRank === Infinity ? 'none' : mountedRank}, verified-rank=${verifiedRank}, activating verified: ${bestVerified.title}`);
            }
            console.log(`[BG-TRIAGE] Activating auto-advance session to pre-queue verified NZB for ${this.contentKey}`);
            this.autoAdvanceSession.activate();
          }
        }
      }
    } else if (!prefetchEnabled && this.verifiedUrls.length > 0) {
      console.log(`[BG-TRIAGE] Prefetch OFF — ${this.verifiedUrls.length} verified NZBs ready for on-demand Smart Play for ${this.contentKey}`);
    }
  }

  /**
   * Build the next batch of candidates to triage.
   * Pulls fresh candidates from allCandidates first, then retries.
   */
  _buildNextBatch(cursor, retryQueue) {
    const batch = [];
    const batchUrls = new Set();

    // Pull fresh candidates from the pool
    while (batch.length < this.batchSize && cursor.index < this.allCandidates.length) {
      const candidate = this.allCandidates[cursor.index];
      cursor.index++;

      // Skip already-decided (unless transient and in retry queue — handled below)
      const existing = this.decisions.get(candidate.downloadUrl);
      if (existing && PERMANENT_STATUSES.has(String(existing.status || '').toLowerCase())) {
        continue;
      }
      // Skip if already in this batch
      if (batchUrls.has(candidate.downloadUrl)) continue;

      batch.push(candidate);
      batchUrls.add(candidate.downloadUrl);
    }

    // Fill remaining slots with transient retries (mark as retried)
    while (batch.length < this.batchSize && retryQueue.length > 0) {
      const candidate = retryQueue.shift();
      if (batchUrls.has(candidate.downloadUrl)) continue;
      // Skip if it got a permanent status since being queued
      const existing = this.decisions.get(candidate.downloadUrl);
      if (existing && PERMANENT_STATUSES.has(String(existing.status || '').toLowerCase())) {
        continue;
      }
      // Mark as retried so we don't retry infinitely
      if (existing) existing._retried = true;
      batch.push(candidate);
      batchUrls.add(candidate.downloadUrl);
    }

    return batch;
  }

  /**
   * Add a newly-verified NZB to the auto-advance queue.
   * Creates the auto-advance session on first verified NZB (with empty initial list),
   * then dynamically pushes verified candidates as they arrive.
   */
  _addVerifiedToAutoAdvance(url) {
    if (this.closed) return;
    const candidate = this.allCandidates.find((c) => c.downloadUrl === url);
    if (!candidate) return;

    const entry = {
      downloadUrl: candidate.downloadUrl,
      title: candidate.title,
      category: this.nzbdavOptions.category,
      size: candidate.size,
      triageStatus: 'verified',
    };

    if (!this.autoAdvanceSession) {
      // Create session with this first verified candidate
      this.autoAdvanceSession = autoAdvanceQueue.createSession(
        this.contentKey,
        [entry],
        {
          queueToNzbdav: this.nzbdavOptions.queueToNzbdav,
          getCachedEntry: this.nzbdavOptions.getCachedEntry,
          backupCount: this.nzbdavOptions.backupCount ?? 1,
          requestedEpisode: this.nzbdavOptions.requestedEpisode,
        },
      );
      console.log(`[BG-TRIAGE] Auto-advance session created for ${this.contentKey} (first verified: ${candidate.title})`);

      // Fastest + prefetch ON: activate immediately so NZBDav starts downloading
      // while triage continues on the remaining batch — BUT only if there is no mounted
      // candidate already available. If there is, the user gets instant playback from
      // the mounted file on click; downloading a verified NZB in parallel is wasteful.
      const prefetchEnabled = this.nzbdavOptions.prefetchEnabled;
      const smartPlayMode = this.nzbdavOptions.smartPlayMode || 'fastest';
      if (prefetchEnabled && smartPlayMode === 'fastest') {
        const mountedForPrefetch = this.getBestMountedCandidate();
        if (mountedForPrefetch) {
          console.log(`[BG-TRIAGE] Fastest + prefetch ON — skipping immediate activation, mounted candidate available: ${mountedForPrefetch.title}`);
        } else {
          console.log(`[BG-TRIAGE] Fastest + prefetch ON — activating immediately for ${this.contentKey}`);
          this.autoAdvanceSession.activate();
        }
      }
    } else {
      // Push into existing session
      this.autoAdvanceSession.addCandidate(entry);
    }
  }
}

function closeAllSessions(reason = 'manual') {
  if (backgroundSessions.size > 0) {
    console.log(`[BG-TRIAGE] Closing all ${backgroundSessions.size} sessions (${reason})`);
  }
  for (const [key, session] of backgroundSessions) {
    session.close();
  }
  backgroundSessions.clear();
}

module.exports = {
  start,
  getSession,
  closeSession,
  closeAllSessions,
  BackgroundTriageSession,
};
