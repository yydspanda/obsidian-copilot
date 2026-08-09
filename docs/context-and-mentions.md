# Context and Mentions

Copilot uses **context** to give the AI information about your notes, selected text, web content, and more. You can control exactly what context the AI sees using automatic context, @-mentions, and manual commands.

---

## Automatic Context

### Active Note

By default, the content of your currently open note is automatically included in every message you send. This means you can ask things like:

- "Summarize this note"
- "What are the action items here?"
- "Add a conclusion section"

To disable automatic note context: **Settings → Copilot → Basic → Auto-add active note to context** (toggle off).

### Active Web Tab (Desktop Only)

If you have the Copilot Web Viewer open alongside your notes, the content of the currently active web tab is automatically included as context (labeled `{activeWebTab}`). This lets you ask the AI to help you work with web content.

### Selected Text

If you highlight text in a note and then type in the chat, the selected text is automatically included as context. This is useful for asking about or transforming a specific part of a note.

You can enable/disable automatic selection adding in **Settings → Copilot → Basic → Auto-add selection to context**.

### Images in Markdown

If your note contains images (e.g., `![[screenshot.png]]`), and you're using a model with **Vision** capability, those images are automatically included in the context. Copilot will pass the image data to the AI so it can see and describe the image.

To control this behavior: **Settings → Copilot → Basic → Pass markdown images to AI**.

---

## @-Mentions

Type `@` in the chat input to mention and include specific items as context.

### @note — Include a Specific Note

Type `@` followed by the note title to add a note to context:

```
@My Meeting Notes tell me what was decided in this meeting
```

The note's full content is included in the request.

### @folder — Include a Folder of Notes

Type `@` followed by a folder name to include all notes in that folder:

```
@Projects/ what tasks are still open?
```

### @tags — Include Notes by Tag

Use `#` after `@` to include all notes with a specific tag:

```
@#work/project summarize the status of the work project
```

### @URL — Include a Web Page

Paste a URL or type `@https://...` to fetch and include a web page's content:

```
@https://example.com/article summarize this article
```

URL processing requires Copilot Plus. YouTube URLs are handled specially — Copilot will fetch the video transcript automatically.

### Tool Mentions

These special @-mentions explicitly trigger tools in Copilot Plus mode:

| Mention                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `@vault`               | Search your vault notes for relevant information |
| `@websearch` or `@web` | Search the internet                              |
| `@composer`            | Create or edit a note                            |
| `@memory`              | Access or update your memory                     |

Example:

```
@vault what did I write about machine learning last month?
@websearch what are the latest changes to the Python packaging ecosystem?
```

---

## Adding Context Manually

### Add Selection to Chat Context

Use the command palette: **Add selection to chat context**

Highlights the selected text and adds it to the chat as context without sending a message. Useful when you want to build up context before sending.

### Add Web Selection to Chat Context

Use the command palette: **Add web selection to chat context**

Works similarly but captures selected text from the Web Viewer. Available on desktop only.

### Choose Chat or Knowledge for a Vault source

When you drag a `.md`, `.markdown`, `.txt`, or `.pdf` file from Obsidian's Vault file explorer into Chat, Copilot pauses before changing either Chat or Knowledge and shows two explicit actions:

- **Use in this chat** adds the existing Vault file to the current Chat context. It does not register a Knowledge source or start background ingestion.
- **Add to Knowledge** registers the existing Vault file as a durable source without adding it to Chat context. After a new registration, the Knowledge workflow restarts and progress appears in Knowledge Studio's **Activity** tab.

**Add to Knowledge** is currently available only on Windows when Knowledge is ready, exactly one Knowledge Bundle is configured, that Bundle has exactly one source folder, and the dropped file already lives inside that folder. Move an outside file into the configured source folder before adding it. Registering the same file again is an idempotent no-op.

For a PDF, **Add to Knowledge** uses Obsidian's local PDF engine to extract bounded text page by page. The original Vault PDF remains the source of record, so accepted citations can reopen an exact page only while its raw file hash still matches; changing the PDF revokes the old citation until the new bytes complete the normal ingest and review flow. It does not use Copilot Plus, Miyo, Brevilabs, a converted Markdown cache, or OCR. Image-only, encrypted, malformed, empty-text, and over-limit PDFs fail closed. A document dragged from Windows Explorer is not captured through this chooser yet; move it into the configured Vault source folder first.

This local parser applies only to **Add to Knowledge**. **Use in this chat** keeps the existing PDF-context behavior described below, including its existing Copilot Plus or configured document-conversion requirements.

### Adding a PDF as Context (Copilot Plus)

Click the **+ Add context** button above the chat input to attach a PDF file. The PDF is converted to text and included as context for your message.

### Adding an Image as Context

Drag an image directly into the chat input box, or click the **image button** in the bottom-right corner of the chat input. The image is sent to the AI if your selected model supports **Vision** capability.

---

## Context Indicators

When context items are added to your message, Copilot shows small pills or badges in the chat input area showing what's included (e.g., the note name, a URL, a tag). This helps you confirm exactly what the AI will see.

---

## Context Behavior by Mode

| Context Type    | Chat              | Vault QA          | Copilot Plus |
| --------------- | ----------------- | ----------------- | ------------ |
| Active note     | Yes (auto)        | Yes (auto)        | Yes (auto)   |
| Selected text   | Yes (auto)        | Yes (auto)        | Yes (auto)   |
| @note / @folder | Yes               | Yes               | Yes          |
| @URL processing | Copilot Plus only | Copilot Plus only | Yes          |
| @vault search   | Yes (explicit)    | Auto              | Auto         |
| @websearch      | No                | No                | Yes          |
| Images (vision) | Yes               | Yes               | Yes          |
| Active web tab  | Desktop only      | Desktop only      | Desktop only |

---

## Related

- [Chat Interface](chat-interface.md) — How the chat panel works
- [Agent Mode and Tools](agent-mode-and-tools.md) — More on @vault and @websearch
- [Vault Search and Indexing](vault-search-and-indexing.md) — How vault search works
