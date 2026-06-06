import Foundation

// MARK: - Mirror of lib/api-types.ts (web)
// Update by hand when the web API contract changes.
// Keep types narrow — only what mobile screens actually consume.

enum API {

    // MARK: Error shapes

    /// Nested admin form: { error: { code, message, error_id } } (§2).
    struct ErrorEnvelope: Decodable {
        let error: ErrorBody

        struct ErrorBody: Decodable {
            let code: String
            let message: String
            let errorId: String?

            enum CodingKeys: String, CodingKey {
                case code, message
                case errorId = "error_id"
            }
        }
    }

    /// Flat form used by job/video routes: { error: string, error_id? }.
    struct FlatError: Decodable {
        let error: String
        let errorId: String?

        enum CodingKeys: String, CodingKey {
            case error
            case errorId = "error_id"
        }
    }

    // MARK: Enums

    enum JobStatus: String, Decodable {
        case queued, running, done, error, cancelled
    }

    enum JobStage: String, Decodable {
        case download, asr, translate, tts, mux
    }

    enum WatchStatus: String, Decodable {
        case toWatch = "to_watch"
        case watched
    }

    enum JobSource: String, Decodable {
        case manual, playlist
    }

    // MARK: Feed — GET /api/jobs -> { jobs: [JobSummary] }

    struct JobsResponse: Decodable {
        let jobs: [JobSummary]
    }

    /// List item. Note the `yt_*` field names (vs normalized names in JobDetail).
    struct JobSummary: Decodable, Identifiable {
        let id: String
        let videoId: String
        let title: String?
        let durationSec: Int?
        let targetLang: String
        let status: JobStatus
        let stage: JobStage?
        let progress: Int
        let audioURL: String?
        let watchStatus: WatchStatus
        let lastPositionSec: Double
        let source: JobSource
        let summary: String?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case videoId = "yt_video_id"
            case title = "yt_title"
            case durationSec = "yt_duration_sec"
            case targetLang = "target_lang"
            case status, stage, progress
            case audioURL = "audio_url"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case source, summary
            case createdAt = "created_at"
        }
    }

    // MARK: Detail — GET /api/jobs/[id] -> { job, segments }

    struct JobDetailResponse: Decodable {
        let job: JobDetail
        let segments: [Segment]
    }

    struct JobDetail: Decodable, Identifiable {
        let id: String
        let url: String
        let videoId: String
        let title: String?
        let durationSec: Int?
        let sourceLang: String?
        let targetLang: String
        let quality: String
        let status: JobStatus
        let stage: JobStage?
        let progress: Int
        let errorMessage: String?
        let errorId: String?
        let audioURL: String?
        let watchStatus: WatchStatus
        let lastPositionSec: Double
        let source: JobSource
        let summary: String?
        let chapters: [Chapter]
        let createdAt: String
        let updatedAt: String
        let finishedAt: String?

        enum CodingKeys: String, CodingKey {
            case id, url
            case videoId = "video_id"
            case title
            case durationSec = "duration_sec"
            case sourceLang = "source_lang"
            case targetLang = "target_lang"
            case quality, status, stage, progress
            case errorMessage = "error_message"
            case errorId = "error_id"
            case audioURL = "audio_url"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case source, summary, chapters
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case finishedAt = "finished_at"
        }
    }

    struct Chapter: Decodable, Identifiable {
        let startSec: Double
        let title: String
        var id: Double { startSec }

        enum CodingKeys: String, CodingKey {
            case startSec = "start_sec"
            case title
        }
    }

    struct Segment: Decodable, Identifiable {
        let idx: Int
        let startMs: Int
        let endMs: Int
        let sourceText: String?
        let translatedText: String?
        var id: Int { idx }

        enum CodingKeys: String, CodingKey {
            case idx
            case startMs = "start_ms"
            case endMs = "end_ms"
            case sourceText = "source_text"
            case translatedText = "translated_text"
        }
    }

    // MARK: Create — POST /api/translate-video

    struct CreateJobRequest: Encodable {
        let url: String
        let targetLang: String
        let quality: String

        enum CodingKeys: String, CodingKey {
            case url
            case targetLang = "target_lang"
            case quality
        }
    }

    struct CreateJobResponse: Decodable {
        let jobId: String
        let cached: Bool

        enum CodingKeys: String, CodingKey {
            case jobId = "job_id"
            case cached
        }
    }

    // MARK: Playback — PATCH /api/jobs/[id]

    struct PlaybackUpdate: Encodable {
        let lastPositionSec: Double?
        let watchStatus: String?

        enum CodingKeys: String, CodingKey {
            case lastPositionSec = "last_position_sec"
            case watchStatus = "watch_status"
        }
    }

    struct OK: Decodable {
        let ok: Bool
    }

    // MARK: Target languages (mirror of TARGET_LANGUAGES in lib/youtube.ts)

    struct Language: Identifiable, Hashable {
        let code: String
        let name: String
        var id: String { code }
    }

    static let targetLanguages: [Language] = [
        .init(code: "ru", name: "Русский"),
        .init(code: "en", name: "English"),
        .init(code: "es", name: "Español"),
        .init(code: "fr", name: "Français"),
        .init(code: "de", name: "Deutsch"),
        .init(code: "it", name: "Italiano"),
        .init(code: "pt", name: "Português"),
        .init(code: "pl", name: "Polski"),
        .init(code: "tr", name: "Türkçe"),
        .init(code: "uk", name: "Українська"),
        .init(code: "nl", name: "Nederlands"),
        .init(code: "cs", name: "Čeština"),
        .init(code: "ar", name: "العربية"),
        .init(code: "zh", name: "中文"),
        .init(code: "ja", name: "日本語"),
        .init(code: "ko", name: "한국어"),
        .init(code: "hi", name: "हिन्दी")
    ]

    // MARK: News — GET /api/news/items, /api/news/enrichment, POST /api/news/feedback

    struct NewsSourceRef: Decodable {
        let id: String
        let name: String
        let kind: String
        let url: String
    }

    struct NewsImage: Decodable, Identifiable {
        let url: String
        let caption: String?
        let sourceURL: String?
        var id: String { url }

        enum CodingKeys: String, CodingKey {
            case url, caption
            case sourceURL = "source_url"
        }
    }

    struct NewsSourceUsed: Decodable, Identifiable {
        let url: String
        let title: String?
        let role: String?
        let whyRelevant: String?
        var id: String { url }

        enum CodingKeys: String, CodingKey {
            case url, title, role
            case whyRelevant = "why_relevant"
        }
    }

    struct NewsEnrichment: Decodable {
        let status: String
        let articleBody: String?
        let keyFacts: [String]?
        let images: [NewsImage]?
        let sourcesUsed: [NewsSourceUsed]?
        let originalSourceURL: String?
        let completedAt: String?
        let synthesisError: String?

        enum CodingKeys: String, CodingKey {
            case status
            case articleBody = "article_body"
            case keyFacts = "key_facts"
            case images
            case sourcesUsed = "sources_used"
            case originalSourceURL = "original_source_url"
            case completedAt = "completed_at"
            case synthesisError = "synthesis_error"
        }
    }

    struct RelatedNewsItem: Decodable, Identifiable {
        let id: String
        let title: String?
        let url: String?
        let sourceName: String?
        let publishedAt: String?
        let relevance: Int?

        enum CodingKeys: String, CodingKey {
            case id, title, url
            case sourceName = "source_name"
            case publishedAt = "published_at"
            case relevance
        }
    }

    struct NewsItem: Decodable, Identifiable {
        let id: String
        let source: NewsSourceRef
        let url: String?
        let title: String?
        let body: String?
        let publishedAt: String?
        let summary: String?
        let valueExplanation: String?
        let matchedTopics: [String]?
        let relevance: Int?
        let verdict: String?
        let reasoning: String?
        let createdAt: String
        let status: String
        let enrichment: NewsEnrichment?
        let related: [RelatedNewsItem]?
        let feedbackSignal: String?

        enum CodingKeys: String, CodingKey {
            case id, source, url, title, body
            case publishedAt = "published_at"
            case summary
            case valueExplanation = "value_explanation"
            case matchedTopics = "matched_topics"
            case relevance, verdict, reasoning
            case createdAt = "created_at"
            case status, enrichment, related
            case feedbackSignal = "feedback_signal"
        }
    }

    struct NewsItemsResponse: Decodable {
        let count: Int
        let items: [NewsItem]
    }

    struct NewsEnrichmentResponse: Decodable {
        let enrichment: NewsEnrichment?
    }

    struct NewsFeedbackRequest: Encodable {
        let itemId: String
        let signal: String
        let reasonChip: String?
        let customText: String?

        enum CodingKeys: String, CodingKey {
            case itemId = "item_id"
            case signal
            case reasonChip = "reason_chip"
            case customText = "custom_text"
        }
    }

    // MARK: Chat — /api/chat/sessions/*, /api/transcribe

    struct ChatSession: Decodable, Identifiable, Hashable {
        let id: String
        let title: String
        let model: String?
        let mode: String?
        let createdAt: String
        let updatedAt: String

        enum CodingKeys: String, CodingKey {
            case id, title, model, mode
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    struct ChatMessage: Decodable, Identifiable {
        let id: String
        let role: String
        let content: String
        let model: String?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id, role, content, model
            case createdAt = "created_at"
        }
    }

    struct ChatSessionsResponse: Decodable {
        let sessions: [ChatSession]
    }

    struct ChatSessionResponse: Decodable {
        let session: ChatSession
    }

    struct ChatSessionDetailResponse: Decodable {
        let session: ChatSession
        let messages: [ChatMessage]
    }

    struct CreateSessionRequest: Encodable {
        let mode: String?
    }

    struct PostMessageRequest: Encodable {
        let content: String
        let mode: String?
    }

    struct TranscribeResponse: Decodable {
        let text: String
        let language: String?
        let duration: Double?
    }

    // MARK: English dialogues — /api/english-dialogues

    struct EnglishDialogueSummary: Decodable, Identifiable {
        let id: String
        let topic: String
        let title: String?
        let kind: String
        let durationMin: Int
        let withTranslation: Int
        let status: String
        let stage: String?
        let progress: Int
        let audioURL: String?
        let durationSec: Double?
        let watchStatus: String
        let lastPositionSec: Double
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id, topic, title, kind
            case durationMin = "duration_min"
            case withTranslation = "with_translation"
            case status, stage, progress
            case audioURL = "audio_url"
            case durationSec = "duration_sec"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case createdAt = "created_at"
        }
    }

    struct EnglishDialoguesResponse: Decodable {
        let jobs: [EnglishDialogueSummary]
    }

    struct EnglishDialogueDetail: Decodable, Identifiable {
        let id: String
        let topic: String
        let title: String?
        let kind: String
        let durationMin: Int
        let withTranslation: Int
        let status: String
        let stage: String?
        let progress: Int
        let errorMessage: String?
        let audioURL: String?
        let durationSec: Double?
        let watchStatus: String
        let lastPositionSec: Double
        let createdAt: String
        let finishedAt: String?

        enum CodingKeys: String, CodingKey {
            case id, topic, title, kind
            case durationMin = "duration_min"
            case withTranslation = "with_translation"
            case status, stage, progress
            case errorMessage = "error_message"
            case audioURL = "audio_url"
            case durationSec = "duration_sec"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case createdAt = "created_at"
            case finishedAt = "finished_at"
        }
    }

    struct EnglishSegment: Decodable, Identifiable {
        let idx: Int
        let startMs: Int
        let endMs: Int
        let speaker: String?
        let enText: String
        let ruText: String?
        var id: Int { idx }

        enum CodingKeys: String, CodingKey {
            case idx
            case startMs = "start_ms"
            case endMs = "end_ms"
            case speaker
            case enText = "en_text"
            case ruText = "ru_text"
        }
    }

    struct EnglishDialogueDetailResponse: Decodable {
        let job: EnglishDialogueDetail
        let segments: [EnglishSegment]
    }

    struct CreateDialogueRequest: Encodable {
        let topic: String
        let durationMin: Int
        let kind: String
        let withTranslation: Bool

        enum CodingKeys: String, CodingKey {
            case topic
            case durationMin = "duration_min"
            case kind
            case withTranslation = "with_translation"
        }
    }

    struct CreateDialogueResponse: Decodable {
        let jobId: String

        enum CodingKeys: String, CodingKey {
            case jobId = "job_id"
        }
    }
}
