(function (window) {

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatDuration(ms) {
        if (!ms || ms <= 0) return '';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor((ms / (1000 * 60 * 60)));

        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m ${seconds}s`;
    }

    function titleCase(str) {
        if (!str) return '';
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    class TemplateEngine {
        constructor(context) {
            this.context = context;
        }

        get(path) {
            if (!path) return undefined;
            return path.split('.').reduce((acc, part) => acc && acc[part], this.context);
        }

        evaluateModifier(value, modifier) {
            const parts = modifier.match(/([a-zA-Z0-9]+)(?:\((.*)\))?/);
            if (!parts) return value;

            const name = parts[1].toLowerCase();
            const argsStr = parts[2];
            let args = [];

            // Simple argument parser for quoted strings
            if (argsStr) {
                const argRegex = /'([^']*)'|"([^"]*)"|([^,]+)/g;
                let match;
                while ((match = argRegex.exec(argsStr)) !== null) {
                    if (match[1] !== undefined) args.push(match[1]);
                    else if (match[2] !== undefined) args.push(match[2]);
                    else if (match[3] !== undefined) args.push(match[3].trim());
                }
            }

            switch (name) {
                case 'istrue': return !!value;
                case 'isfalse': return !value;
                case 'exists': return value !== undefined && value !== null && value !== '';
                case 'length': return Array.isArray(value) ? value.length : String(value || '').length;
                case 'lower': return String(value || '').toLowerCase();
                case 'upper': return String(value || '').toUpperCase();
                case 'title': return titleCase(String(value || ''));
                case 'bytes': return formatBytes(Number(value) || 0);
                case 'time': return formatDuration(Number(value) || 0);
                case 'join': return Array.isArray(value) ? value.join(args[0] || ', ') : value;
                case 'replace': {
                    const search = args[0];
                    const replace = args[1] || '';
                    return String(value || '').split(search).join(replace);
                }
                // 'and' is handled in processBlock, but if it leaks here, return value
                case 'and': return value;
                default:
                    // Handle comparisons: >0, <0, =0 etc.
                    if (name.startsWith('>')) {
                        const threshold = parseFloat(name.substring(1));
                        return Number(value) > threshold;
                    }
                    if (name.startsWith('<')) {
                        const threshold = parseFloat(name.substring(1));
                        return Number(value) < threshold;
                    }
                    if (name.startsWith('=')) {
                        const threshold = parseFloat(name.substring(1));
                        return Number(value) === threshold;
                    }
                    return value;
            }
        }

        processBlock(blockContent) {
            // Matches "everything then optional [ ... ] at the end"
            const blockRegex = /^(.*?)(?:\[(.*)\])?$/s;
            const match = blockContent.match(blockRegex);
            if (!match) return '';

            const expression = match[1];
            const conditional = match[2]; // "trueVal||falseVal"

            const parts = expression.split('::');

            let value = this.get(parts[0]);
            let accumulator = null; // Stores boolean state of chained AND logic

            for (let i = 1; i < parts.length; i++) {
                const mod = parts[i];

                // Handle 'and' logic: stream.folderSize::>0::and::stream.size::>0
                if (mod === 'and') {
                    const currentBool = !!value;
                    if (accumulator === null) accumulator = currentBool;
                    else accumulator = accumulator && currentBool;

                    // Move to next key if available
                    if (i + 1 < parts.length) {
                        i++;
                        const nextKey = parts[i];
                        value = this.get(nextKey);
                    }
                    continue;
                }

                value = this.evaluateModifier(value, mod);
            }

            // Fold final value into accumulator if we did any 'and' operations
            if (accumulator !== null) {
                value = accumulator && !!value;
            }

            // Handle conditional output
            if (conditional !== undefined) {
                const delim = '||';
                const condParts = conditional.split(delim);

                const stripQuotes = (s) => {
                    s = s.trim();
                    let params = s;
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                        params = s.substring(1, s.length - 1);
                    }
                    return params.replace(/\\n/g, '\n');
                };

                const trueVal = stripQuotes(condParts[0] || '');
                const falseVal = stripQuotes(condParts.slice(1).join(delim) || '');

                return value ? trueVal : falseVal;
            }

            return value !== undefined && value !== null ? String(value) : '';
        }

        render(template) {
            let result = template;
            const maxIterations = 50;
            let iteration = 0;

            // Recursive resolution
            while (result.match(/\{[^{}]+\}/) && iteration < maxIterations) {
                result = result.replace(/\{([^{}]+)\}/g, (match, content) => {
                    return this.processBlock(content);
                });
                iteration++;
            }

            // Cleanup empty lines (AIOStreams behavior)
            // Split by newline, remove lines that are purely whitespace, then rejoin
            return result.split('\n')
                .filter(line => line.trim() !== '')
                .join('\n');
        }
    }


    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TemplateEngine;
    } else {
        window.TemplateEngine = TemplateEngine;
    }
})(typeof window !== 'undefined' ? window : this);
