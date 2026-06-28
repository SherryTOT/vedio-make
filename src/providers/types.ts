/**
 * Capability interfaces. Each capability (chat / tts / music / image / search)
 * has one TypeScript interface; concrete adapters implement it. The pipeline
 * commands consume the interfaces and never depend on a specific provider.
 *
 * Add a new provider:
 *   1. Implement one or more of these interfaces under providers/<id>/
 *   2. Register the factory in providers/registry.ts under the right capability
 *   3. The CLI flag --provider=<id> automatically picks it up
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClient {
  /** Provider id, e.g. "minimax", "deepseek", "openai" */
  id: string;
  /** OpenAI-compatible chat completion. Returns the text content (with provider-specific reasoning blocks stripped). */
  chat(opts: {
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<string>;
}

export interface TtsClient {
  id: string;
  /** List of voice ids known to work on this provider, with friendly labels for UIs. */
  voices(): { id: string; label: string; gender?: "male" | "female"; tags?: string[] }[];
  /** Synthesize speech. Returns the audio buffer (default mp3). */
  tts(opts: {
    text: string;
    voiceId?: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    sampleRate?: 16000 | 24000 | 32000 | 44100;
    bitrate?: 64000 | 96000 | 128000 | 256000;
    format?: "mp3" | "pcm" | "flac" | "wav";
    /** MiniMax-only: neutral|happy|sad|angry|fearful|disgusted|surprised. Ignored by other engines. */
    emotion?: string;
    /** MiniMax-only: spell out latin acronyms ("USB" → "U S B"). Ignored elsewhere. */
    englishNormalization?: boolean;
    /** MiniMax-only: language hint, e.g. "Chinese"/"English". Empty = auto. Ignored elsewhere. */
    languageBoost?: string;
  }): Promise<Buffer>;
}

export interface MusicClient {
  id: string;
  music(opts: {
    prompt: string;
    lyrics?: string;
    format?: "mp3" | "wav";
  }): Promise<Buffer>;
}

export interface ImageClient {
  id: string;
  /** Generate one or more images. Returns array of buffers (mp3-equivalent for images). */
  image(opts: {
    prompt: string;
    /** Aspect ratio. Provider-specific; common values: "16:9", "9:16", "1:1" */
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
    /** Number of images to generate. Default 1. Providers may cap (Minimax max=9). */
    n?: number;
    /** Style hint, e.g. "cinematic", "anime", "minimal". Provider-dependent. */
    style?: string;
  }): Promise<Buffer[]>;
}

export interface SearchClient {
  id: string;
  /**
   * Web search. Returns ranked results with snippets. Some providers (Minimax)
   * route this through their chat tool; others (Tavily, Perplexity) have a
   * dedicated endpoint.
   */
  search(opts: {
    query: string;
    /** Number of results to return. Default 5. */
    limit?: number;
    /** Recency filter, e.g. "year", "month", "week". Provider-dependent. */
    recency?: "any" | "year" | "month" | "week" | "day";
  }): Promise<{ title: string; url: string; snippet: string }[]>;
}

/**
 * Asset provider: search a stock/asset library, return downloadable URLs.
 *
 * Concrete adapters:
 *   - Pexels / Unsplash / Pixabay (free public APIs)
 *   - 51yuansu / Envato Elements (require puppeteer + user-supplied cookies;
 *     scraping ToS-grey — provided as "available if user accepts risk")
 */
export interface AssetSearchResult {
  /** Provider-internal id (used for download endpoints that need it) */
  id: string;
  /** Provider name (always matches client.id) */
  provider: string;
  /** Asset kind */
  type: "photo" | "video" | "illustration" | "vector" | "music" | "psd" | "icon" | "template";
  /** Direct download URL (or page URL when the provider doesn't expose direct CDN) */
  downloadUrl: string;
  /** Preview / thumbnail URL */
  previewUrl?: string;
  /** Width × Height in pixels (best-known) */
  width?: number;
  height?: number;
  /** Author / contributor */
  author?: string;
  /** Free-form license string (e.g. "Pexels License", "Envato Elements") */
  license?: string;
  /** Original page URL on the provider's site */
  pageUrl?: string;
  /** Provider-supplied title or caption */
  title?: string;
  /** Tags */
  tags?: string[];
}

export interface AssetClient {
  id: string;
  /** Search the library by free-text query. */
  search(opts: {
    query: string;
    type?: AssetSearchResult["type"];
    /** Aspect / orientation hint */
    orientation?: "landscape" | "portrait" | "square";
    /** Max results */
    limit?: number;
  }): Promise<AssetSearchResult[]>;
  /**
   * Download a single result to a local file. Returns absolute path written.
   * Some providers need their own session/auth which the adapter handles.
   */
  download(result: AssetSearchResult, destPath: string): Promise<string>;
}

export type Capability = "chat" | "tts" | "music" | "image" | "search" | "asset";
export type CapabilityClient =
  | ChatClient
  | TtsClient
  | MusicClient
  | ImageClient
  | SearchClient
  | AssetClient;
