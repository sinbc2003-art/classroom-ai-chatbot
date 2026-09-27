// Classroom Chatbot Client - Student Side
document.addEventListener("DOMContentLoaded", () => {
    // State
    let studentId = localStorage.getItem("classroom_student_id") || null;
    let studentName = localStorage.getItem("classroom_student_name") || null;
    let sessionId = localStorage.getItem("classroom_session_id") || null;
    let isStreaming = false;

    // Elements
    const chatMessages = document.getElementById("chat-messages");
    const welcomeBanner = document.getElementById("welcome-banner");
    const chatForm = document.getElementById("chat-form");
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");
    const sendIcon = document.getElementById("send-icon");
    const loadingSpinner = document.getElementById("loading-spinner");
    const nameModal = document.getElementById("name-modal");
    const nameForm = document.getElementById("name-form");
    const studentNameInput = document.getElementById("student-name-input");
    const studentBadgeBtn = document.getElementById("student-badge-btn");
    const studentNameDisplay = document.getElementById("student-name-display");
    const newChatBtn = document.getElementById("new-chat-btn");
    const activeModelBadge = document.getElementById("active-model-badge");
    const toast = document.getElementById("toast");

    // Configure Marked options
    if (window.marked) {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // Initialize
    fetchSystemInfo();
    if (!studentId || !studentName) {
        openNameModal();
    } else {
        updateStudentBadge(studentName);
        loginStudent(studentName, false);
    }

    // Auto-expand textarea
    userInput.addEventListener("input", () => {
        userInput.style.height = "auto";
        userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
    });

    // Enter to submit (Shift+Enter for newline)
    userInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && userInput.value.trim()) {
                chatForm.dispatchEvent(new Event("submit"));
            }
        }
    });

    // Handle student badge click (change name)
    studentBadgeBtn.addEventListener("click", () => {
        openNameModal(studentName);
    });

    // Handle name submission
    nameForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const inputVal = studentNameInput.value.trim();
        if (!inputVal) return;
        
        await loginStudent(inputVal, true);
        nameModal.classList.add("hidden");
    });

    // Handle new chat button
    newChatBtn.addEventListener("click", async () => {
        if (!studentId || isStreaming) return;
        try {
            const res = await fetch("/api/student/new-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ student_id: parseInt(studentId) })
            });
            const data = await res.json();
            sessionId = data.session_id;
            localStorage.setItem("classroom_session_id", sessionId);

            // Clear chat UI
            chatMessages.innerHTML = "";
            chatMessages.appendChild(welcomeBanner);
            welcomeBanner.classList.remove("hidden");
            userInput.value = "";
            userInput.style.height = "auto";
            showToast("새로운 대화가 시작되었습니다.");
        } catch (err) {
            console.error("New chat error:", err);
            showToast("새 대화 생성 중 오류가 발생했습니다.");
        }
    });

    // Sample prompts
    document.querySelectorAll(".sample-prompt-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const text = btn.innerText.split(":").slice(1).join(":").trim();
            if (text) {
                userInput.value = text;
                userInput.style.height = "auto";
                userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
                chatForm.dispatchEvent(new Event("submit"));
            }
        });
    });

    // Chat submit
    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const messageText = userInput.value.trim();
        if (!messageText || isStreaming) return;

        if (!studentId || !sessionId) {
            openNameModal();
            return;
        }

        // Hide welcome banner
        if (welcomeBanner) welcomeBanner.classList.add("hidden");

        // Append user bubble
        appendUserMessage(messageText);

        // Clear input
        userInput.value = "";
        userInput.style.height = "auto";

        // Append assistant placeholder
        const assistantElem = createAssistantMessageElement();
        chatMessages.appendChild(assistantElem);
        scrollToBottom();

        // Lock send
        setStreamingState(true);

        try {
            const response = await fetch("/api/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    student_id: parseInt(studentId),
                    session_id: parseInt(sessionId),
                    message: messageText
                })
            });

            if (!response.ok) {
                throw new Error(`서버 응답 오류 (${response.status})`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let accumulatedText = "";
            const contentDiv = assistantElem.querySelector(".message-content");
            contentDiv.classList.add("typing-cursor");

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop(); // Keep partial line

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("data: ")) {
                        const jsonStr = trimmed.slice(6);
                        try {
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.delta) {
                                accumulatedText += parsed.delta;
                                // Simple update during stream
                                contentDiv.innerHTML = renderMarkdownWithMath(accumulatedText);
                                scrollToBottom();
                            } else if (parsed.error) {
                                accumulatedText += `\n\n> ⚠️ **오류:** ${parsed.error}`;
                                contentDiv.innerHTML = renderMarkdownWithMath(accumulatedText);
                            } else if (parsed.done) {
                                // Completed
                            }
                        } catch (pe) {
                            console.error("JSON parse error from stream:", pe);
                        }
                    }
                }
            }

            // Remove typing cursor
            contentDiv.classList.remove("typing-cursor");
            // Final render with MathJax and code highlight
            await finalizeRender(contentDiv, accumulatedText);

        } catch (err) {
            console.error("Chat error:", err);
            const contentDiv = assistantElem.querySelector(".message-content");
            contentDiv.classList.remove("typing-cursor");
            contentDiv.innerHTML = `<div class="p-3 bg-red-50 text-red-600 rounded-lg text-xs">⚠️ 연결 실패: ${err.message}</div>`;
        } finally {
            setStreamingState(false);
            scrollToBottom();
        }
    });

    // Helper functions
    async function fetchSystemInfo() {
        try {
            const res = await fetch("/api/info");
            const data = await res.json();
            if (data.active_model) {
                activeModelBadge.textContent = data.active_model;
            }
        } catch (e) {
            console.error("Failed to load info", e);
        }
    }

    async function loginStudent(name, isNewLogin = false) {
        try {
            const res = await fetch("/api/student/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name })
            });
            if (!res.ok) throw new Error("로그인 실패");

            const data = await res.json();
            studentId = data.id;
            studentName = data.name;
            sessionId = data.session_id;

            localStorage.setItem("classroom_student_id", studentId);
            localStorage.setItem("classroom_student_name", studentName);
            localStorage.setItem("classroom_session_id", sessionId);

            updateStudentBadge(studentName);

            if (isNewLogin) {
                // Clear and show welcome
                chatMessages.innerHTML = "";
                chatMessages.appendChild(welcomeBanner);
                welcomeBanner.classList.remove("hidden");
                showToast(`${studentName}님, 환영합니다!`);
            } else {
                // Load existing conversation
                loadSessionMessages(sessionId);
            }
        } catch (err) {
            console.error("Login student err:", err);
            openNameModal();
        }
    }

    async function loadSessionMessages(sId) {
        try {
            const res = await fetch(`/api/student/messages/${sId}`);
            const data = await res.json();
            if (data.messages && data.messages.length > 0) {
                if (welcomeBanner) welcomeBanner.classList.add("hidden");
                chatMessages.innerHTML = "";
                for (const m of data.messages) {
                    if (m.role === "user") {
                        appendUserMessage(m.content);
                    } else if (m.role === "assistant") {
                        const elem = createAssistantMessageElement();
                        chatMessages.appendChild(elem);
                        const contentDiv = elem.querySelector(".message-content");
                        await finalizeRender(contentDiv, m.content);
                    }
                }
                scrollToBottom();
            }
        } catch (e) {
            console.error("Failed to load session messages", e);
        }
    }

    function openNameModal(currentName = "") {
        studentNameInput.value = currentName;
        nameModal.classList.remove("hidden");
        studentNameInput.focus();
    }

    function updateStudentBadge(name) {
        studentNameDisplay.textContent = name;
    }

    function setStreamingState(streaming) {
        isStreaming = streaming;
        sendBtn.disabled = streaming;
        if (streaming) {
            sendIcon.classList.add("hidden");
            loadingSpinner.classList.remove("hidden");
        } else {
            sendIcon.classList.remove("hidden");
            loadingSpinner.classList.add("hidden");
        }
    }

    function appendUserMessage(text) {
        const div = document.createElement("div");
        div.className = "flex justify-end items-start gap-2.5 animate-fade-in";
        div.innerHTML = `
            <div class="max-w-[85%] md:max-w-[75%] bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm text-sm leading-relaxed whitespace-pre-wrap select-text">
                ${escapeHtml(text)}
            </div>
            <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold shrink-0">
                ${studentName ? studentName.slice(0, 2) : "나"}
            </div>
        `;
        chatMessages.appendChild(div);
    }

    function createAssistantMessageElement() {
        const div = document.createElement("div");
        div.className = "flex justify-start items-start gap-3 animate-fade-in";
        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold shrink-0 shadow-sm">
                AI
            </div>
            <div class="max-w-[90%] md:max-w-[85%] bg-white border border-slate-200/80 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm text-slate-800">
                <div class="message-content prose-chat select-text"></div>
            </div>
        `;
        return div;
    }

    function renderMarkdownWithMath(rawText) {
        if (!rawText) return "";
        
        // 1. Protect display math $$...$$
        const mathBlocks = [];
        let text = rawText.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
            const id = `%%MATHBLOCK_${mathBlocks.length}%%`;
            mathBlocks.push(match);
            return id;
        });

        // 2. Protect display math \[...\]
        text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match) => {
            const id = `%%MATHBLOCK_${mathBlocks.length}%%`;
            mathBlocks.push(match);
            return id;
        });

        // 3. Protect inline math $...$
        const mathInlines = [];
        text = text.replace(/\$([^\$\n\r]+?)\$/g, (match) => {
            const id = `%%MATHINLINE_${mathInlines.length}%%`;
            mathInlines.push(match);
            return id;
        });

        // 4. Protect inline math \(...\)
        text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match) => {
            const id = `%%MATHINLINE_${mathInlines.length}%%`;
            mathInlines.push(match);
            return id;
        });

        // 5. Parse Markdown
        let html = window.marked ? marked.parse(text) : text;

        // 6. Restore math blocks
        mathBlocks.forEach((math, i) => {
            html = html.replace(`%%MATHBLOCK_${i}%%`, math);
        });

        // 7. Restore inline math
        mathInlines.forEach((math, i) => {
            html = html.replace(`%%MATHINLINE_${i}%%`, math);
        });

        return html;
    }

    async function finalizeRender(container, text) {
        container.innerHTML = renderMarkdownWithMath(text);

        // Highlight code blocks
        if (window.hljs) {
            container.querySelectorAll("pre code").forEach((block) => {
                hljs.highlightElement(block);
                
                // Add copy button
                const pre = block.parentElement;
                if (!pre.querySelector(".copy-btn")) {
                    const copyBtn = document.createElement("button");
                    copyBtn.className = "copy-btn absolute top-2 right-2 text-xs bg-slate-700/80 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition opacity-80 hover:opacity-100";
                    copyBtn.textContent = "복사";
                    copyBtn.onclick = () => {
                        navigator.clipboard.writeText(block.textContent);
                        copyBtn.textContent = "복사완료!";
                        setTimeout(() => { copyBtn.textContent = "복사"; }, 2000);
                    };
                    pre.appendChild(copyBtn);
                }
            });
        }

        // Render MathJax
        if (window.MathJax && MathJax.typesetPromise) {
            try {
                await MathJax.typesetPromise([container]);
            } catch (err) {
                console.warn("MathJax typeset error:", err);
            }
        }
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.remove("hidden");
        setTimeout(() => {
            toast.classList.add("hidden");
        }, 2800);
    }
});
