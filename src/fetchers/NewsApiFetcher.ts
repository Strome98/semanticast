import { Article } from "../types";
import { Agent } from 'undici';

// Minimal fetcher for https://newsapi.org (Free tier: 100 requests/day, no full text)
// This class focuses on the /v2/everything endpoint for keyword search.
// It can be adapted to other providers by implementing the same shape.
export class NewsApiFetcher {
    private readonly baseUrl = 'https://newsapi.org/v2';

    public constructor(private readonly apiKey: string) {
        if (!apiKey) {
            throw new Error('NewsApiFetcher requires an API key');
        }
    }

    /**
     * Fetch articles matching provided query terms.
     * @param query e.g. "rare earth metal" or list of element names
     * @param from optional ISO date string to restrict start time
     * @param pageSize up to 100 (free tier may limit)
     * @param page pagination index starting at 1
     */
    public async fetchEverything(query: string, { from, pageSize = 50, page = 1 }: { from?: string; pageSize?: number; page?: number } = {}): Promise<Article[]> {
        const params = new URLSearchParams({
            q: query,
            language: 'en',
            sortBy: 'publishedAt',
            pageSize: String(pageSize),
            page: String(page)
        });
        if (from) params.set('from', from);

        const url = `${this.baseUrl}/everything?${params.toString()}`;
        const res = await this.fetchWithRetry(url);
        const json = await res.json();
        const rawArticles: any[] = json.articles ?? [];
        return rawArticles.map(a => normalizeNewsApiArticle(a));
    }

    /**
     * Convenience method to fetch multiple pages until pageLimit or no more results.
     */
    public async fetchAllPages(query: string, { from, pageSize = 50, pageLimit = 3 }: { from?: string; pageSize?: number; pageLimit?: number } = {}): Promise<Article[]> {
        const all: Article[] = [];
        for (let page = 1; page <= pageLimit; page++) {
            const batch = await this.fetchEverything(query, { from, pageSize, page });
            if (!batch.length) break;
            all.push(...batch);
            if (batch.length < pageSize) break; // last page
        }
        // de-duplicate by id
        const map = new Map<string, Article>();
        all.forEach(a => map.set(a.id, a));
        return [...map.values()];
    }

    /**
     * Build a rare earth focused query string.
     * NewsAPI interprets space as AND. Use quoted phrases and OR for breadth.
     */
    public buildRareEarthQuery(extraTerms: string[] = []): string {
        const baseTerms = [
            '"rare earth"', 'neodymium', 'dysprosium', 'terbium', 'yttrium', 'scandium', 'lanthanum', 'cerium',
            'praseodymium', 'samarium', 'europium', 'gadolinium', 'holmium', 'erbium', 'thulium', 'ytterbium', 'lutetium',
            'lithium', 'cobalt'
        ];
        const all = [...new Set([...baseTerms, ...extraTerms])];
        // Join with OR to broaden search, minimize exceeding length (NewsAPI limit ~500 chars)
        const query = all.join(' OR ');
        return query.slice(0, 480); // safety truncate
    }

    private async fetchWithRetry(url: string, attempt = 1): Promise<Response> {
        // Optional insecure / custom TLS handling for corporate proxies.
        // If ALLOW_INSECURE_TLS=true we disable certificate validation (NOT recommended for production).
        // If CUSTOM_CA_FILE is provided, advise user to set NODE_EXTRA_CA_CERTS before starting Node.
        const allowInsecure = process.env.ALLOW_INSECURE_TLS === 'true';
        const dispatcher = allowInsecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

        let res: Response;
        try {
            res = await fetch(url, {
                headers: { 'X-Api-Key': this.apiKey },
                // Undici custom dispatcher for TLS tweaks
                ...(dispatcher ? { dispatcher } : {})
            });
        } catch (e: any) {
            // Surface certificate guidance for common Node TLS error codes
            if (e?.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') {
                throw new Error(`TLS certificate chain not trusted. If you're behind a corporate proxy:
1. Export the proxy/root certificate to a .pem file.
2. Set NODE_EXTRA_CA_CERTS=path/to/certs.pem before running 'npm run dev'.
3. (Temporary only) set ALLOW_INSECURE_TLS=true in .env to bypass validation.\nOriginal error: ${e.message}`);
            }
            throw e;
        }
        if (res.status === 429) {
            if (attempt > 3) throw new Error('NewsAPI rate limit exceeded after retries');
            const waitMs = 1000 * attempt * 5; // linear backoff
            await new Promise(r => setTimeout(r, waitMs));
            return this.fetchWithRetry(url, attempt + 1);
        }
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`NewsAPI error ${res.status}: ${text}`);
        }
        return res;
    }
}

function normalizeNewsApiArticle(a: any): Article {
    return {
        id: a.url, // use URL as id (unique enough)
        url: a.url,
        source: a.source?.name || 'unknown',
        title: a.title || '',
        description: a.description || undefined,
        publishedAt: a.publishedAt || undefined,
        content: a.content || undefined,
        author: a.author || undefined,
        language: 'en'
    };
}