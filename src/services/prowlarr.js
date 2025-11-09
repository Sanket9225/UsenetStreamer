const axios = require('axios');
const {
  INDEXER_MANAGER_BASE_URL,
  INDEXER_MANAGER_API_KEY,
  // Legacy exports for getIndexers
  PROWLARR_URL,
  PROWLARR_API_KEY
} = require('../config/environment');
const { ensureProwlarrConfigured } = require('../utils/validators');

/**
 * Fetch available indexers from Prowlarr with their categories
 * @returns {Promise<Array>} Array of indexer objects with id, name, protocol, and categories
 */
async function getIndexers() {
  ensureProwlarrConfigured();

  try {
    const response = await axios.get(`${PROWLARR_URL}/api/v1/indexer`, {
      headers: { 'X-Api-Key': PROWLARR_API_KEY },
      timeout: 10000
    });

    const indexers = Array.isArray(response.data) ? response.data : [];

    // Filter to only enabled indexers and map to format with categories
    const enabledIndexers = indexers
      .filter(indexer => indexer && indexer.enable === true)
      .map(indexer => {
        // Extract categories from capabilities with error handling
        const categories = [];
        try {
          if (indexer.capabilities && indexer.capabilities.categories && Array.isArray(indexer.capabilities.categories)) {
            indexer.capabilities.categories.forEach(cat => {
              if (!cat || !cat.id || !cat.name) return;

              // Main category
              categories.push({
                id: cat.id,
                name: cat.name
              });

              // Subcategories if they exist
              if (cat.subCategories && Array.isArray(cat.subCategories)) {
                cat.subCategories.forEach(subCat => {
                  if (!subCat || !subCat.id || !subCat.name) return;
                  categories.push({
                    id: subCat.id,
                    name: `${cat.name} > ${subCat.name}`
                  });
                });
              }
            });
          }
        } catch (error) {
          console.warn(`[PROWLARR] Failed to extract categories for indexer ${indexer.name}:`, error.message);
        }

        return {
          id: indexer.id,
          name: indexer.name,
          protocol: indexer.protocol,
          priority: indexer.priority || 25,
          categories: categories
        };
      })
      .sort((a, b) => {
        // Sort by priority (lower number = higher priority), then by name
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.name.localeCompare(b.name);
      });

    console.log(`[PROWLARR] Retrieved ${enabledIndexers.length} enabled indexers with categories`);
    return enabledIndexers;
  } catch (error) {
    console.error('[PROWLARR] Failed to fetch indexers:', error.message);
    throw new Error(`Failed to fetch Prowlarr indexers: ${error.message}`);
  }
}

/**
 * Build search params for Prowlarr
 * @param {object} plan - Search plan
 * @param {object} options - Search options
 * @param {Array<number>} options.selectedIndexers - Array of selected indexer IDs
 * @param {object} options.selectedCategories - Category selections
 * @param {string} options.type - Content type (for category filtering)
 * @returns {object} Prowlarr search params
 */
function buildProwlarrSearchParams(plan, options = {}) {
  // Determine which indexers to use
  let indexerIds = '-1'; // Default: all indexers
  if (options.selectedIndexers && Array.isArray(options.selectedIndexers) && options.selectedIndexers.length > 0) {
    indexerIds = options.selectedIndexers.join(',');
    console.log(`[PROWLARR] Using selected indexers: ${indexerIds}`);
  } else {
    console.log('[PROWLARR] No indexers selected, using all available indexers');
  }

  const params = {
    limit: '100',
    offset: '0',
    type: plan.type,
    query: plan.query,
    indexerIds
  };

  // Determine which categories to use
  // Collect all unique category IDs from all selected indexers
  let categories = null;
  if (options.selectedCategories && typeof options.selectedCategories === 'object' && Object.keys(options.selectedCategories).length > 0) {
    const categorySet = new Set();

    // If specific indexers are selected, only use categories for those indexers
    if (options.selectedIndexers && Array.isArray(options.selectedIndexers) && options.selectedIndexers.length > 0) {
      options.selectedIndexers.forEach(indexerId => {
        const indexerCategories = options.selectedCategories[String(indexerId)] || options.selectedCategories[indexerId];
        if (Array.isArray(indexerCategories) && indexerCategories.length > 0) {
          indexerCategories.forEach(catId => categorySet.add(catId));
        }
      });
    } else {
      // No specific indexers selected, use all category selections
      Object.values(options.selectedCategories).forEach(indexerCategories => {
        if (Array.isArray(indexerCategories) && indexerCategories.length > 0) {
          indexerCategories.forEach(catId => categorySet.add(catId));
        }
      });
    }

    if (categorySet.size > 0) {
      categories = Array.from(categorySet).join(',');
      console.log(`[PROWLARR] Using selected categories: ${categories}`);
    } else {
      console.log('[PROWLARR] No valid categories found in selection, using all categories');
    }
  } else {
    console.log('[PROWLARR] No category filtering applied, using all categories');
  }

  // For text-based searches, include categories
  // For ID-based searches, Prowlarr might not support category filtering
  if (plan.type === 'search' && categories) {
    params.categories = categories;
  }

  return params;
}

/**
 * Execute search against Prowlarr
 * @param {object} plan - Search plan
 * @param {object} options - Search options
 * @param {Array<number>} options.selectedIndexers - Array of selected indexer IDs
 * @param {object} options.selectedCategories - Category selections
 * @param {string} options.type - Content type
 * @returns {Promise<Array>} Search results
 */
async function executeSearch(plan, options = {}) {
  const params = buildProwlarrSearchParams(plan, options);

  console.log('[PROWLARR] Executing search with params:', JSON.stringify(params, null, 2));

  try {
    const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api/v1/search`, {
      params,
      headers: { 'X-Api-Key': INDEXER_MANAGER_API_KEY },
      timeout: 60000
    });

    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    // If search fails with categories, log it
    if (error.response && error.response.status === 400 && params.categories) {
      console.warn('[PROWLARR] Search failed with categories, might not be supported for this search type', {
        type: plan.type,
        query: plan.query,
        categories: params.categories
      });
    }
    throw error;
  }
}

module.exports = {
  getIndexers,
  executeSearch
};
