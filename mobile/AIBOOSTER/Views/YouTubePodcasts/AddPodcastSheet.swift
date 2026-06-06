import SwiftUI

/// Sheet to submit a YouTube URL for translation.
/// `onSubmit` returns nil on success or an error message to show inline.
struct AddPodcastSheet: View {
    let onSubmit: (_ url: String, _ lang: String, _ quality: String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var lang = "ru"
    @State private var quality = "best"
    @State private var submitting = false
    @State private var error: String?

    private var trimmedURL: String {
        url.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://youtube.com/watch?v=…", text: $url, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .lineLimit(1...3)
                } header: {
                    Text("Ссылка на видео или плейлист")
                }

                Section("Язык перевода") {
                    Picker("Язык", selection: $lang) {
                        ForEach(API.targetLanguages) { l in
                            Text(l.name).tag(l.code)
                        }
                    }
                }

                Section("Качество") {
                    Picker("Качество", selection: $quality) {
                        Text("Лучшее").tag("best")
                        Text("Быстрое").tag("fast")
                    }
                    .pickerStyle(.segmented)
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.youtube)
                    }
                }
            }
            .navigationTitle("Новый подкаст")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if submitting {
                        ProgressView()
                    } else {
                        Button("Добавить") { Task { await submit() } }
                            .disabled(trimmedURL.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(submitting)
        }
    }

    private func submit() async {
        submitting = true
        error = nil
        let result = await onSubmit(trimmedURL, lang, quality)
        submitting = false
        if let result {
            error = result
        } else {
            dismiss()
        }
    }
}
