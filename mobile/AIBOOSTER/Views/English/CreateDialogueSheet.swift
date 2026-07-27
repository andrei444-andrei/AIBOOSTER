import SwiftUI

/// Sheet to generate a new English dialogue/monologue.
/// `onSubmit` returns nil on success or an error message to show inline.
struct CreateDialogueSheet: View {
    let onSubmit: (_ topic: String, _ durationMin: Int, _ kind: String, _ withTranslation: Bool) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var topic = ""
    @State private var durationMin = 5
    @State private var kind = "dialogue"
    @State private var withTranslation = true
    @State private var submitting = false
    @State private var error: String?

    private let durations = [3, 5, 7, 10]

    private var trimmedTopic: String {
        topic.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Тема") {
                    TextField("О чём разговор? напр.: заказ кофе в лондонском кафе", text: $topic, axis: .vertical)
                        .lineLimit(1...4)
                }

                Section("Формат") {
                    Picker("Тип", selection: $kind) {
                        Text("Диалог").tag("dialogue")
                        Text("Монолог").tag("monologue")
                    }
                    .pickerStyle(.segmented)

                    Picker("Длительность", selection: $durationMin) {
                        ForEach(durations, id: \.self) { Text("\($0) мин").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    Toggle("С переводом на русский", isOn: $withTranslation)
                }

                if let error {
                    Section {
                        Text(error).font(.system(size: 13)).foregroundStyle(Theme.youtube)
                    }
                }
            }
            .navigationTitle("Новый разговор")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if submitting {
                        ProgressView()
                    } else {
                        Button("Создать") { Task { await submit() } }
                            .disabled(trimmedTopic.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(submitting)
        }
    }

    private func submit() async {
        submitting = true
        error = nil
        let result = await onSubmit(trimmedTopic, durationMin, kind, withTranslation)
        submitting = false
        if let result { error = result } else { dismiss() }
    }
}
