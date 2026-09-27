// Classroom Chatbot Platform - Admin Dashboard Logic
document.addEventListener("DOMContentLoaded", () => {
    // State
    let adminPin = sessionStorage.getItem("classroom_admin_pin") || "";
    let cachedStudents = [];
    let activeStudentDetailId = null;
    let qrCodeObj = null;

    // Elements
    const pinModal = document.getElementById("pin-modal");
    const pinForm = document.getElementById("pin-form");
    const pinInput = document.getElementById("pin-input");
    const pinError = document.getElementById("pin-error");
    const logoutBtn = document.getElementById("logout-btn");
    const adminToast = document.getElementById("admin-toast");

    // Tabs
    const tabBtns = {
        dashboard: document.getElementById("tab-btn-dashboard"),
        settings: document.getElementById("tab-btn-settings"),
        students: document.getElementById("tab-btn-students")
    };
    const tabContents = {
        dashboard: document.getElementById("tab-content-dashboard"),
        settings: document.getElementById("tab-content-settings"),
        students: document.getElementById("tab-content-students")
    };

    // Dashboard Elements
    const serverUrlDisplay = document.getElementById("server-url-display");
    const copyUrlBtn = document.getElementById("copy-url-btn");
    const qrcodeContainer = document.getElementById("qrcode-container");
    const statActiveModel = document.getElementById("stat-active-model");
    const statStudentCount = document.getElementById("stat-student-count");
    const statMessageCount = document.getElementById("stat-message-count");
    const statApiStatus = document.getElementById("stat-api-status");

    // Settings Elements
    const apiKeyBadge = document.getElementById("api-key-badge");
    const openaiApiKeyInput = document.getElementById("openai-api-key-input");
    const toggleKeyVisibility = document.getElementById("toggle-key-visibility");
    const saveKeyBtn = document.getElementById("save-key-and-fetch-models-btn");
    const apiKeySaveStatus = document.getElementById("api-key-save-status");
    const modelSelect = document.getElementById("model-select");
    const refreshModelsBtn = document.getElementById("refresh-models-btn");
    const applyModelBtn = document.getElementById("apply-model-btn");
    const systemPromptInput = document.getElementById("system-prompt-input");
    const savePromptBtn = document.getElementById("save-prompt-btn");
    const temperatureSlider = document.getElementById("temperature-slider");
    const tempValueDisplay = document.getElementById("temp-value-display");
    const newPinInput = document.getElementById("new-pin-input");
    const changePinBtn = document.getElementById("change-pin-btn");

    // Students Elements
    const studentSearchInput = document.getElementById("student-search-input");
    const refreshStudentsBtn = document.getElementById("refresh-students-btn");
    const exportAllCsvBtn = document.getElementById("export-all-csv-btn");
    const clearAllHistoryBtn = document.getElementById("clear-all-history-btn");
    const studentTableBody = document.getElementById("student-table-body");

    // Conversation Modal Elements
    const conversationModal = document.getElementById("conversation-modal");
    const modalStudentName = document.getElementById("modal-student-name");
    const modalStudentMeta = document.getElementById("modal-student-meta");
    const modalExportStudentCsv = document.getElementById("modal-export-student-csv");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalMessagesContainer = document.getElementById("modal-messages-container");

    // System Prompt Presets
    const presets = {
        math: "당신은 학생들을 위한 친절한 수학 탐구 튜터입니다. 공식을 일방적으로 주지 않고, 스스로 유도할 수 있도록 단계별 힌트와 발문을 제공하세요. 수식은 반드시 LaTeX 문법($...$, $$...$$)으로 명확히 표현하세요.",
        socratic: "당신은 소크라테스식 문답법을 사용하는 교육 AI입니다. 학생의 질문에 직접적인 정답을 바로 주지 말고, 스스로 생각하여 정답에 도달할 수 있도록 유도 질문을 1~2개씩 던져 생각을 확장시켜 주세요.",
        science: "당신은 과학 탐구 보조교사입니다. 가설 설정과 변인 통제, 관찰 결과 해석 과정을 친절히 지도하고 과학적 원리를 실생활 비유를 들어 알기 쉽게 설명해 주세요.",
        coding: "당신은 파이썬 및 프로그래밍 코치입니다. 완성된 코드를 바로 복사해 주기보다는 오류 원인과 알고리즘의 핵심 논리를 단계별로 짚어주고 디버깅 방법을 조언해 주세요.",
        friendly: "당신은 학생들을 위한 친절하고 다정한 AI 교육 보조교사입니다. 눈높이에 맞춰 쉽고 따뜻한 어조로 성심성의껏 답변해 주세요. 수식은 LaTeX 문법을 활용하세요."
    };

    // --- Authentication Flow ---
    if (adminPin) {
        verifyPinAndInit(adminPin);
    } else {
        showPinModal();
    }

    pinForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const pin = pinInput.value.trim();
        if (!pin) return;
        await verifyPinAndInit(pin);
    });

    logoutBtn.addEventListener("click", () => {
        sessionStorage.removeItem("classroom_admin_pin");
        adminPin = "";
        showPinModal();
    });

    async function verifyPinAndInit(pin) {
        try {
            const res = await fetch("/api/admin/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                adminPin = pin;
                sessionStorage.setItem("classroom_admin_pin", adminPin);
                pinModal.classList.add("hidden");
                pinError.classList.add("hidden");
                initDashboard();
            } else {
                pinError.textContent = "비밀번호가 올바르지 않습니다.";
                pinError.classList.remove("hidden");
            }
        } catch (err) {
            console.error(err);
            pinError.textContent = "서버 연결 오류가 발생했습니다.";
            pinError.classList.remove("hidden");
        }
    }

    function showPinModal() {
        pinInput.value = "";
        pinError.classList.add("hidden");
        pinModal.classList.remove("hidden");
        pinInput.focus();
    }

    // --- Tab Switching ---
    Object.keys(tabBtns).forEach(tabKey => {
        tabBtns[tabKey].addEventListener("click", () => {
            switchTab(tabKey);
        });
    });

    function switchTab(activeKey) {
        Object.keys(tabBtns).forEach(key => {
            if (key === activeKey) {
                tabBtns[key].classList.add("border-indigo-600", "text-indigo-600");
                tabBtns[key].classList.remove("border-transparent", "text-slate-500");
                tabContents[key].classList.remove("hidden");
            } else {
                tabBtns[key].classList.remove("border-indigo-600", "text-indigo-600");
                tabBtns[key].classList.add("border-transparent", "text-slate-500");
                tabContents[key].classList.add("hidden");
            }
        });

        if (activeKey === "students") {
            loadStudents();
        } else if (activeKey === "settings") {
            loadSettings();
        } else if (activeKey === "dashboard") {
            loadDashboardStats();
        }
    }

    // --- Dashboard & QR Code ---
    function initDashboard() {
        loadSettings();
        loadDashboardStats();
        loadStudents();
    }

    async function loadDashboardStats() {
        try {
            const res = await fetch(`/api/admin/settings?pin=${encodeURIComponent(adminPin)}`);
            if (!res.ok) return;
            const data = await res.json();

            // Update URLs
            const fullUrl = `http://${data.server_ip}:${data.port}`;
            serverUrlDisplay.value = fullUrl;

            // Generate QR Code
            renderQRCode(fullUrl);

            // Update stats
            statActiveModel.textContent = data.active_model;
            if (data.has_api_key) {
                statApiStatus.textContent = "정상 등록됨 (준비 완료)";
                statApiStatus.className = "text-sm font-bold text-emerald-600";
            } else {
                statApiStatus.textContent = "미등록 (설정 필요)";
                statApiStatus.className = "text-sm font-bold text-amber-600";
            }

            // Student Count
            const sRes = await fetch(`/api/admin/students?pin=${encodeURIComponent(adminPin)}`);
            if (sRes.ok) {
                const sData = await sRes.json();
                statStudentCount.textContent = `${sData.students.length}명`;
                const totalMsgs = sData.students.reduce((acc, curr) => acc + (curr.message_count || 0), 0);
                statMessageCount.textContent = `${totalMsgs}건`;
            }

        } catch (e) {
            console.error("Failed to load dashboard stats", e);
        }
    }

    function renderQRCode(url) {
        if (!qrcodeContainer) return;
        qrcodeContainer.innerHTML = "";
        try {
            if (window.QRCode) {
                qrCodeObj = new QRCode(qrcodeContainer, {
                    text: url,
                    width: 130,
                    height: 130,
                    colorDark: "#1e1b4b",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
            } else {
                qrcodeContainer.innerHTML = `<span class="text-xs text-slate-400">QR 코드 생성 대기 중</span>`;
            }
        } catch (err) {
            console.warn("QR code render error:", err);
        }
    }

    copyUrlBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(serverUrlDisplay.value);
        showToast("접속 URL이 클립보드에 복사되었습니다!");
    });

    // --- Settings & OpenAI API ---
    toggleKeyVisibility.addEventListener("click", () => {
        if (openaiApiKeyInput.type === "password") {
            openaiApiKeyInput.type = "text";
            toggleKeyVisibility.textContent = "숨기기";
        } else {
            openaiApiKeyInput.type = "password";
            toggleKeyVisibility.textContent = "보기";
        }
    });

    async function loadSettings() {
        try {
            const res = await fetch(`/api/admin/settings?pin=${encodeURIComponent(adminPin)}`);
            if (!res.ok) return;
            const data = await res.json();

            if (data.has_api_key) {
                apiKeyBadge.textContent = "등록됨 (" + data.masked_api_key + ")";
                apiKeyBadge.className = "text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold";
                openaiApiKeyInput.placeholder = "새 키를 입력하여 변경할 수 있습니다.";
            } else {
                apiKeyBadge.textContent = "미등록";
                apiKeyBadge.className = "text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold";
            }

            systemPromptInput.value = data.system_prompt || "";
            temperatureSlider.value = data.temperature || "0.7";
            tempValueDisplay.textContent = temperatureSlider.value;

            // Load models if key exists
            if (data.has_api_key) {
                fetchModels(data.active_model);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    saveKeyBtn.addEventListener("click", async () => {
        const key = openaiApiKeyInput.value.trim();
        if (!key) {
            alert("OpenAI API 키를 입력해 주세요.");
            return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.innerHTML = `<span>⏳</span><span>키 확인 및 모델 불러오는 중...</span>`;

        try {
            // First save key
            const saveRes = await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pin: adminPin,
                    openai_api_key: key
                })
            });

            if (!saveRes.ok) throw new Error("API 키 저장 실패");

            // Now fetch models
            await fetchModels();
            openaiApiKeyInput.value = "";
            showToast("API 키가 저장되고 모델 목록을 성공적으로 불러왔습니다!");
            loadSettings();
            loadDashboardStats();
        } catch (err) {
            alert("오류: " + err.message);
        } finally {
            saveKeyBtn.disabled = false;
            saveKeyBtn.innerHTML = `<span>💾</span><span>API 키 저장 및 모델 목록 조회</span>`;
        }
    });

    refreshModelsBtn.addEventListener("click", () => {
        fetchModels();
    });

    async function fetchModels(currentActive = null) {
        try {
            refreshModelsBtn.innerHTML = `<span>⏳ 불러오는 중...</span>`;
            const res = await fetch(`/api/admin/models?pin=${encodeURIComponent(adminPin)}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.detail || "모델 목록 조회 실패");
            }

            const active = currentActive || data.current_model || "gpt-4o-mini";
            modelSelect.innerHTML = "";

            // Group: 인기/추천 모델
            const optgroupChat = document.createElement("optgroup");
            optgroupChat.label = "⭐ 추천 대화형 모델";
            data.chat_models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m;
                opt.textContent = m + (m === "gpt-4o-mini" ? " (추천: 가성비/속도 우수)" : (m === "gpt-4o" ? " (고성능 플래그십)" : ""));
                if (m === active) opt.selected = true;
                optgroupChat.appendChild(opt);
            });
            modelSelect.appendChild(optgroupChat);

            // Group: 기타 전체 모델
            const optgroupAll = document.createElement("optgroup");
            optgroupAll.label = "📦 기타 모델 전체";
            data.all_models.forEach(m => {
                if (!data.chat_models.includes(m)) {
                    const opt = document.createElement("option");
                    opt.value = m;
                    opt.textContent = m;
                    if (m === active) opt.selected = true;
                    optgroupAll.appendChild(opt);
                }
            });
            modelSelect.appendChild(optgroupAll);

            showToast("모델 목록을 갱신했습니다.");
        } catch (err) {
            console.error("Model fetch error:", err);
            // Leave current options
        } finally {
            refreshModelsBtn.innerHTML = `<span>🔄 모델 목록 새로고침</span>`;
        }
    }

    applyModelBtn.addEventListener("click", async () => {
        const selectedModel = modelSelect.value;
        if (!selectedModel) return;

        try {
            const res = await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pin: adminPin,
                    active_model: selectedModel
                })
            });

            if (res.ok) {
                statActiveModel.textContent = selectedModel;
                showToast(`서빙 모델이 [${selectedModel}]로 적용되었습니다!`);
            } else {
                alert("모델 변경 실패");
            }
        } catch (e) {
            console.error(e);
            alert("서버 연결 실패");
        }
    });

    // Preset buttons for system prompt
    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const presetKey = btn.getAttribute("data-preset");
            if (presets[presetKey]) {
                systemPromptInput.value = presets[presetKey];
            }
        });
    });

    savePromptBtn.addEventListener("click", async () => {
        const prompt = systemPromptInput.value.trim();
        try {
            const res = await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pin: adminPin,
                    system_prompt: prompt
                })
            });

            if (res.ok) {
                showToast("시스템 프롬프트가 저장되었습니다.");
            } else {
                alert("프롬프트 저장 실패");
            }
        } catch (e) {
            alert("서버 연결 실패");
        }
    });

    temperatureSlider.addEventListener("input", () => {
        tempValueDisplay.textContent = temperatureSlider.value;
    });

    temperatureSlider.addEventListener("change", async () => {
        try {
            await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pin: adminPin,
                    temperature: temperatureSlider.value
                })
            });
            showToast(`답변 창의성(Temperature)이 ${temperatureSlider.value}로 설정되었습니다.`);
        } catch (e) {
            console.error(e);
        }
    });

    changePinBtn.addEventListener("click", async () => {
        const newPin = newPinInput.value.trim();
        if (!newPin || newPin.length < 4) {
            alert("비밀번호는 최소 4자리 이상이어야 합니다.");
            return;
        }

        try {
            const res = await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pin: adminPin,
                    new_admin_pin: newPin
                })
            });

            if (res.ok) {
                adminPin = newPin;
                sessionStorage.setItem("classroom_admin_pin", adminPin);
                newPinInput.value = "";
                showToast("관리자 비밀번호가 성공적으로 변경되었습니다.");
            } else {
                alert("비밀번호 변경 실패");
            }
        } catch (e) {
            alert("서버 연결 실패");
        }
    });

    // --- Students Monitoring & CSV Export ---
    async function loadStudents() {
        try {
            const res = await fetch(`/api/admin/students?pin=${encodeURIComponent(adminPin)}`);
            if (!res.ok) return;
            const data = await res.json();
            cachedStudents = data.students || [];
            renderStudentTable(cachedStudents);
        } catch (e) {
            console.error("Failed to load students", e);
        }
    }

    function renderStudentTable(students) {
        studentTableBody.innerHTML = "";
        if (students.length === 0) {
            studentTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="p-8 text-center text-slate-400">
                        접속한 학생이 아직 없습니다.
                    </td>
                </tr>
            `;
            return;
        }

        students.forEach(s => {
            const tr = document.createElement("tr");
            tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
            tr.innerHTML = `
                <td class="p-3.5 pl-6 font-bold text-slate-800 flex items-center gap-2">
                    <span class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                        ${s.name.slice(0, 1)}
                    </span>
                    <span>${escapeHtml(s.name)}</span>
                </td>
                <td class="p-3.5 text-slate-500">${formatDate(s.created_at)}</td>
                <td class="p-3.5 text-slate-500">${formatDate(s.last_active)}</td>
                <td class="p-3.5 font-medium text-slate-700">${s.session_count}개</td>
                <td class="p-3.5 font-medium text-indigo-600">${s.message_count}건</td>
                <td class="p-3.5 pr-6 text-right space-x-1.5 whitespace-nowrap">
                    <button class="view-student-btn px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition" data-id="${s.id}">
                        대화 내역 보기
                    </button>
                    <button class="export-student-btn px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition" data-id="${s.id}" title="CSV 다운로드">
                        CSV
                    </button>
                    <button class="delete-student-btn px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs transition" data-id="${s.id}" data-name="${escapeHtml(s.name)}" title="학생 및 대화 삭제">
                        삭제
                    </button>
                </td>
            `;
            studentTableBody.appendChild(tr);
        });

        // Attach action handlers
        studentTableBody.querySelectorAll(".view-student-btn").forEach(btn => {
            btn.addEventListener("click", () => openStudentModal(btn.getAttribute("data-id")));
        });

        studentTableBody.querySelectorAll(".export-student-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const sId = btn.getAttribute("data-id");
                window.location.href = `/api/admin/export/csv?pin=${encodeURIComponent(adminPin)}&student_id=${sId}`;
            });
        });

        studentTableBody.querySelectorAll(".delete-student-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const sId = btn.getAttribute("data-id");
                const sName = btn.getAttribute("data-name");
                if (confirm(`정말 [${sName}] 학생과 모든 대화 내역을 삭제하시겠습니까?`)) {
                    await deleteStudent(sId);
                }
            });
        });
    }

    studentSearchInput.addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
            renderStudentTable(cachedStudents);
        } else {
            const filtered = cachedStudents.filter(s => s.name.toLowerCase().includes(q));
            renderStudentTable(filtered);
        }
    });

    refreshStudentsBtn.addEventListener("click", () => {
        loadStudents();
        showToast("학생 목록을 새로고침했습니다.");
    });

    exportAllCsvBtn.addEventListener("click", () => {
        window.location.href = `/api/admin/export/csv?pin=${encodeURIComponent(adminPin)}`;
    });

    clearAllHistoryBtn.addEventListener("click", async () => {
        const confirmText = prompt("경고: 모든 학생과 대화 내역이 완전히 삭제됩니다!\n초기화를 진행하려면 '초기화'를 입력하세요.");
        if (confirmText === "초기화") {
            try {
                const res = await fetch("/api/admin/clear-all-history", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pin: adminPin })
                });
                if (res.ok) {
                    showToast("모든 대화 내역이 초기화되었습니다.");
                    loadStudents();
                    loadDashboardStats();
                } else {
                    alert("초기화 실패");
                }
            } catch (e) {
                alert("서버 연결 실패");
            }
        }
    });

    async function deleteStudent(studentId) {
        try {
            const res = await fetch(`/api/admin/students/${studentId}?pin=${encodeURIComponent(adminPin)}`, {
                method: "DELETE"
            });
            if (res.ok) {
                showToast("학생 데이터가 삭제되었습니다.");
                loadStudents();
                loadDashboardStats();
            } else {
                alert("삭제 실패");
            }
        } catch (e) {
            alert("서버 연결 실패");
        }
    }

    // --- Student Conversation Modal ---
    async function openStudentModal(studentId) {
        activeStudentDetailId = studentId;
        modalMessagesContainer.innerHTML = `<div class="text-center py-10 text-slate-400">대화 내역을 불러오는 중...</div>`;
        conversationModal.classList.remove("hidden");

        try {
            const res = await fetch(`/api/admin/students/${studentId}?pin=${encodeURIComponent(adminPin)}`);
            if (!res.ok) throw new Error("불러오기 실패");
            const data = await res.json();

            modalStudentName.textContent = `${data.student.name} 학생 대화 내역`;
            modalStudentMeta.textContent = `등록일: ${formatDate(data.student.created_at)} | 총 세션: ${data.sessions.length}개`;

            modalMessagesContainer.innerHTML = "";
            if (data.sessions.length === 0) {
                modalMessagesContainer.innerHTML = `<div class="text-center py-10 text-slate-400">대화 내역이 없습니다.</div>`;
                return;
            }

            data.sessions.forEach(sess => {
                const sessCard = document.createElement("div");
                sessCard.className = "bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 mb-4";
                
                let messagesHtml = "";
                if (sess.messages.length === 0) {
                    messagesHtml = `<div class="text-xs text-slate-400 italic">메시지 없음</div>`;
                } else {
                    sess.messages.forEach(m => {
                        const isUser = m.role === "user";
                        messagesHtml += `
                            <div class="flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}">
                                ${!isUser ? '<span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">AI</span>' : ''}
                                <div class="max-w-[85%] text-xs rounded-xl p-3 ${isUser ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-800 rounded-tl-none'}">
                                    <div class="whitespace-pre-wrap leading-relaxed select-text">${escapeHtml(m.content)}</div>
                                    <div class="text-[10px] mt-1 text-right ${isUser ? 'text-indigo-200' : 'text-slate-400'}">
                                        ${m.created_at} ${m.model ? `(${m.model})` : ''}
                                    </div>
                                </div>
                                ${isUser ? '<span class="text-xs font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">학생</span>' : ''}
                            </div>
                        `;
                    });
                }

                sessCard.innerHTML = `
                    <div class="flex items-center justify-between border-b border-slate-100 pb-2 text-xs font-semibold text-slate-500">
                        <span>세션 #${sess.id} (${sess.title})</span>
                        <span>${sess.created_at}</span>
                    </div>
                    <div class="space-y-2.5 pt-1">
                        ${messagesHtml}
                    </div>
                `;
                modalMessagesContainer.appendChild(sessCard);
            });

        } catch (err) {
            modalMessagesContainer.innerHTML = `<div class="text-center py-10 text-red-500">대화 내역을 불러오지 못했습니다.</div>`;
        }
    }

    modalCloseBtn.addEventListener("click", () => {
        conversationModal.classList.add("hidden");
    });

    modalExportStudentCsv.addEventListener("click", () => {
        if (activeStudentDetailId) {
            window.location.href = `/api/admin/export/csv?pin=${encodeURIComponent(adminPin)}&student_id=${activeStudentDetailId}`;
        }
    });

    // Helper functions
    function formatDate(dtStr) {
        if (!dtStr) return "-";
        return dtStr.replace("T", " ").slice(0, 19);
    }

    function escapeHtml(str) {
        return (str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(msg) {
        adminToast.textContent = msg;
        adminToast.classList.remove("hidden");
        setTimeout(() => {
            adminToast.classList.add("hidden");
        }, 2800);
    }
});
