import Foundation

// MARK: - Mirror of lib/api-types.ts (web)
// Update by hand when the web API contract changes.
// Keep types narrow — only what mobile screens actually consume.

enum API {
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
}
