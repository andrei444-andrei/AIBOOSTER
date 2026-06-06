import SwiftUI

/// Input bar: mode selector, text field, voice (mic) button, send.
struct ChatComposer: View {
    @Binding var text: String
    @Binding var mode: ChatMode
    let sending: Bool
    var placeholder: String = "Сообщение…"
    let onSend: () -> Void

    @StateObject private var recorder = VoiceRecorder()
    @State private var micDenied = false

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
    }

    var body: some View {
        VStack(spacing: 6) {
            if micDenied {
                Text("Нет доступа к микрофону — включи в Настройках.")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.youtube)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 8) {
                modeMenu
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 16))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Theme.bgSubtle)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(Theme.border, lineWidth: 1)
                            )
                    )
                micButton
                sendButton
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s2)
        .background(.bar)
    }

    private var modeMenu: some View {
        Menu {
            ForEach(ChatMode.allCases) { m in
                Button { mode = m } label: {
                    Label(m.title, systemImage: m == mode ? "checkmark" : m.systemImage)
                }
            }
        } label: {
            Image(systemName: mode.systemImage)
                .font(.system(size: 20))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 36, height: 36)
        }
    }

    private var micButton: some View {
        Button { toggleMic() } label: {
            Group {
                switch recorder.state {
                case .recording:
                    Image(systemName: "stop.circle.fill").foregroundStyle(Theme.youtube)
                case .transcribing:
                    ProgressView()
                case .idle:
                    Image(systemName: "mic.fill").foregroundStyle(Theme.textSecondary)
                }
            }
            .font(.system(size: 22))
            .frame(width: 36, height: 36)
        }
        .disabled(sending || recorder.state == .transcribing)
    }

    private var sendButton: some View {
        Button(action: onSend) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(canSend ? Theme.accent : Theme.textMuted)
        }
        .disabled(!canSend)
    }

    private func toggleMic() {
        Task {
            if recorder.isRecording {
                if let transcript = await recorder.stopAndTranscribe() {
                    text = text.isEmpty ? transcript : text + " " + transcript
                }
            } else {
                let granted = await recorder.requestPermission()
                if granted {
                    micDenied = false
                    recorder.start()
                } else {
                    micDenied = true
                }
            }
        }
    }
}
