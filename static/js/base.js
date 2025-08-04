 // WebRTC and WebSocket configuration
        // const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // const wsUrl = ${protocol}//${window.location.hostname}:8765;10.204.39.98:8765
       
        const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = `${wsProtocol}://${window.location.host}/ws`;


        let ws, myName, myCode, pc, dataChannel, targetName;
        let hasMicrophone = false;
        let unreadCounts = {};
        let callTimer, callStartTime;

        // File transfer variables
        let incomingFile = null;
        let incomingFileBuffer = [];
        let incomingFileSize = 0;
        let receivedFileSize = 0;
        let queuedIceCandidates = [];

        // DOM Elements
        const registrationModal = document.getElementById('registrationModal');
        const appContainer = document.getElementById('appContainer');
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        const contactsList = document.getElementById('contactsList');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const chatWithNameEl = document.getElementById('chatWithName');
        const chatStatusTextEl = document.getElementById('chatStatusText');
        const chatMessagesEl = document.getElementById('chatMessages');
        const chatTextEl = document.getElementById('chatText');
        const sendChatBtn = document.getElementById('sendChatBtn');
        const voiceCallBtn = document.getElementById('voiceCallBtn');
        const callContainer = document.getElementById('callContainer');
        const callNameEl = document.getElementById('callName');
        const callAvatarEl = document.getElementById('callAvatar');
        const callStatusEl = document.getElementById('callStatus');
        const callTimerEl = document.getElementById('callTimer');
        const endCallBtn = document.getElementById('endCallBtn');
        const attachmentBtn = document.getElementById('attachmentBtn');
        const fileInput = document.getElementById('fileInput');
        const userSearch = document.getElementById('userSearch');

        // Initialize the application
        $(document).ready(() => {
            requestNotificationPermission();
            clearOldLocalStorage();

            // Show registration modal
            registrationModal.style.display = 'flex';

            // Register button click handler
            $('#registerBtn').click(() => {
                const name = $('#nameInput').val().trim();
                if (!name) {
                    showToast("Name Required", "Please enter your name");
                    return;
                }

                // Initialize WebSocket connection
                connectWebSocket(name);
            });

            // Send message button and enter key handlers
            sendChatBtn.addEventListener('click', sendChatMessage);
            chatTextEl.addEventListener('keypress', (e) => {
                if (e.which === 13 && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                }
            });

            // File attachment handler
            attachmentBtn.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', handleFileUpload);

            // Call button handler
            voiceCallBtn.addEventListener('click', () => {
                if (targetName) startCall(targetName);
            });

            // End call button
            endCallBtn.addEventListener('click', endCall);

            // Check for microphone availability
            if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    hasMicrophone = devices.some(d => d.kind === 'audioinput');
                });
            }
        });

        function connectWebSocket(name) {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'register', name }));
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                showToast('Connection error', 'Please refresh the page.');
            };

            ws.onclose = () => {
                showToast('Connection lost', 'Reconnecting...');
                setTimeout(() => {
                    connectWebSocket(myName || name);
                }, 3000);
            };

            ws.onmessage = async (e) => {
                const msg = JSON.parse(e.data);
                handleWebSocketMessage(msg);
            };
        }

        function handleWebSocketMessage(msg) {
            switch (msg.type) {
                case 'registered':
                    handleRegistration(msg);
                    break;
                case 'user_list':
                    handleUserList(msg.users);
                    break;
                case 'offer':
                    if (msg.isDataOnly) {
                        handleIncomingDataOffer(msg);
                    } else {
                        handleIncomingVoiceCall(msg);  // Use the new function here
                    }
                    break;
                case 'answer':
                    handleCallAnswer(msg);
                    break;
                case 'candidate':
                    handleIceCandidate(msg);
                    break;
                case 'call-reject':
                    handleCallRejected();
                    break;
            }
        }

        // NEW FUNCTION: Handle incoming voice call
        function handleIncomingVoiceCall(msg) {
            targetName = msg.from;

            // Update call UI
            callNameEl.textContent = msg.from;
            callAvatarEl.textContent = msg.from.substring(0, 2).toUpperCase();
            callStatusEl.textContent = 'Incoming Call';
            callTimerEl.textContent = '00:00';
            callContainer.classList.add('active');

            // Add accept/reject buttons
            const callControls = document.querySelector('.call-controls');
            callControls.innerHTML = `
        <button class="call-btn accept" id="acceptCallBtn">
            <i class="fas fa-phone"></i>
        </button>
        <button class="call-btn decline" id="rejectCallBtn">
            <i class="fas fa-phone-slash"></i>
        </button>`
    ;

            document.getElementById('acceptCallBtn').addEventListener('click', () => answerCall(msg.offer));
            document.getElementById('rejectCallBtn').addEventListener('click', rejectCall);

            // Show notification
            showToast("Incoming Call", `${msg.from} is calling you`);
        }

        // NEW FUNCTION: Handle data-only offers (chat connections)

        function handleIncomingDataOffer(msg) {
            targetName = msg.from;

            // Initialize peer connection for data
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            queuedIceCandidates = [];  // Reset ICE queue

            pc.onicecandidate = e => {
                if (e.candidate) {
                    ws.send(JSON.stringify({
                        type: 'candidate',
                        from: myName,
                        to: targetName,
                        candidate: e.candidate
                    }));
                }
            };

            // Set up data channel
            pc.ondatachannel = event => {
                dataChannel = event.channel;
                setupDataChannel();
            };

            // Set remote description and create answer
            pc.setRemoteDescription(new RTCSessionDescription(msg.offer))
                .then(() => {
                    processIceCandidateQueue();  // Process queued candidates
                    return pc.createAnswer();
                })
                .then(answer => pc.setLocalDescription(answer))
                .then(() => {
                    ws.send(JSON.stringify({
                        type: 'answer',
                        from: myName,
                        to: targetName,
                        answer: pc.localDescription,
                        isDataOnly: true
                    }));
                })
                .catch(error => {
                    console.error('Error handling data offer:', error);
                    showToast('Connection Error', 'Could not establish data connection');
                });
        }





        function processIceCandidateQueue() {
            if (!pc) return;

            while (queuedIceCandidates.length > 0) {
                const candidate = queuedIceCandidates.shift();
                pc.addIceCandidate(candidate)
                    .catch(e => console.log("Processed queued ICE candidate"));
            }
        }
        function handleRegistration(msg) {
            myName = msg.name;
            myCode = msg.code;

            // Update UI
            userNameEl.textContent = myName;
            userAvatarEl.textContent = myName.substring(0, 2).toUpperCase();

            // Hide registration modal, show app
            registrationModal.style.display = 'none';
            appContainer.style.display = 'flex';

            saveCurrentDateTag();
            showToast("Connected", "You're now online");
        }

        function handleUserList(users) {
            // Hide loading indicator
            loadingIndicator.style.display = 'none';

            // Clear existing contacts
            contactsList.innerHTML = '';

            // Group online and offline users
            const onlineUsers = [];
            const offlineUsers = [];

            users.forEach(u => {
                if (u.code === myCode) return; // Skip self

                if (u.is_online) {
                    onlineUsers.push(u);
                } else {
                  //  offlineUsers.push(u);
                }
            });

            // Add online users
            if (onlineUsers.length > 0) {
                const onlineHeader = document.createElement('div');
                onlineHeader.className = 'px-3 py-2 small text-muted';
                onlineHeader.textContent = 'Online';
                contactsList.appendChild(onlineHeader);

                onlineUsers.forEach(u => {
                    contactsList.appendChild(createContactItem(u));
                });
            }

            // Add offline users
            if (offlineUsers.length > 0) {
                const offlineHeader = document.createElement('div');
                offlineHeader.className = 'px-3 py-2 small text-muted mt-3';
                offlineHeader.textContent = 'Offline';
                contactsList.appendChild(offlineHeader);

                offlineUsers.forEach(u => {
                    contactsList.appendChild(createContactItem(u));
                });
            }

            // If no users
            if (onlineUsers.length === 0 && offlineUsers.length === 0) {
                contactsList.innerHTML = 
                   ` <div class="text-center py-5 text-muted">
                        <i class="fas fa-user-friends fa-2x mb-3"></i>
                        <p>No other users online</p>
                    </div>`
                ;
            }

            // Save users for later use
            localStorage.setItem('latestUsers', JSON.stringify(users));
        }

        function createContactItem(user) {
            const contactItem = document.createElement('div');
            contactItem.className = 'contact-item';
            contactItem.dataset.name = user.name;
            contactItem.dataset.code = user.code;
            contactItem.dataset.status = user.is_online ? 'online' : 'offline';

            // Generate avatar from initials
            const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            contactItem.innerHTML = 
                `<div class="contact-avatar" style="background: ${stringToColor(user.name)}">
                    ${initials}
                </div>
                <div class="contact-details">
                    <div class="contact-name">
                        ${user.name}
                        ${unreadCounts[user.name] ? `<span class="notification-badge">${unreadCounts[user.name]}</span>` : ''}
                    </div>
                    <div class="contact-last-msg">${user.is_online ? 'Online' : 'Offline'}</div>
                </div>
                <div class="contact-time"></div>`
            ;

            contactItem.addEventListener('click', () => openChat(user.name, user.code));

            return contactItem;
        }

        function stringToColor(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            let color = '#';
            for (let i = 0; i < 3; i++) {
                const value = (hash >> (i * 8)) & 0xFF;
                color += ('00' + value.toString(16)).substr(-2);
            }
            return color;
        }

        function openChat(user, code) {
            if (user === myName) {
                showToast("Error", "You can't chat with yourself");
                return;
            }

            targetName = user;

            // Update UI
            chatWithNameEl.textContent = user;
            chatStatusTextEl.textContent = 'Online';
            document.getElementById('chatStatusIndicator').style.backgroundColor = '#28a745';

            // Clear unread count
            unreadCounts[user] = 0;
            updateUserList();

            // Enable chat input
            chatTextEl.disabled = false;
            sendChatBtn.disabled = false;

            // Load chat history
            loadChatHistory(myName, user);

            // Connect if not already connected
            if (!dataChannel || dataChannel.readyState !== 'open') {
                showToast("Connecting", `Connecting to ${user}...`);
                startDataConnection(user);
            }
        }

        function startDataConnection(user) {
            targetName = user;

            // Initialize peer connection
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

            pc.onicecandidate = e => {
                if (e.candidate) {
                    ws.send(JSON.stringify({
                        type: 'candidate',
                        from: myName,
                        to: targetName,
                        candidate: e.candidate
                    }));
                }
            };

            // Create data channel for chat
            dataChannel = pc.createDataChannel('chat');
            setupDataChannel();

            // Create and send offer
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    ws.send(JSON.stringify({
                        type: 'offer',
                        from: myName,
                        to: targetName,
                        offer: pc.localDescription,
                        isDataOnly: true
                    }));
                })
                .catch(error => {
                    console.error('Error creating data offer:', error);
                    showToast('Connection Error', 'Could not start chat connection');
                });
        }

        function setupDataChannel() {
            if (!dataChannel) return;

            dataChannel.onopen = () => {
                console.log('Data channel opened');
                showToast("Connected", `Connected to ${targetName}`);

                // Enable chat input
                chatTextEl.disabled = false;
                sendChatBtn.disabled = false;
            };

            dataChannel.onclose = () => {
                console.log('Data channel closed');
                showToast("Disconnected", `Connection to ${targetName} lost`);

                // Disable chat input
                chatTextEl.disabled = true;
                sendChatBtn.disabled = true;
            };

            dataChannel.onmessage = e => {
                if (typeof e.data === 'string') {
                    try {
                        const data = JSON.parse(e.data);

                        // Handle file metadata
                        if (data.fileName && data.fileSize) {
                            incomingFile = data;
                            incomingFileBuffer = [];
                            receivedFileSize = 0;
                            incomingFileSize = data.fileSize;
                            return;
                        }

                        // Handle chat message
                        if (data.type === 'chat') {
                            appendChatMessage(data.sender, data.msg, true, data.msgId, 'read');

                            // Send read receipt if chat is open
                            if (chatWithNameEl.textContent === data.sender && dataChannel.readyState === 'open') {
                                dataChannel.send(JSON.stringify({ type: 'read', msgId: data.msgId }));
                            }

                            // Show notification if chat is not active
                            if (targetName !== data.sender) {
                                unreadCounts[data.sender] = (unreadCounts[data.sender] || 0) + 1;
                                updateUserList();
                                showBrowserNotification("New Message", `From ${data.sender}: ${data.msg}`);
                            }
                            return;
                        }

                        // Handle read receipt
                        if (data.type === 'read') {
                            const tickElement = document.getElementById(`${data.msgId}`);
                            if (tickElement) {
                                tickElement.innerHTML = '<i class="fas fa-check-double"></i>';
                            }
                            return;
                        }
                    } catch (err) {
                        // Not JSON - treat as plain text message
                        appendChatMessage(targetName, e.data, true);
                    }
                } else {
                    // Binary data (file transfer)
                    incomingFileBuffer.push(e.data);
                    receivedFileSize += e.data.byteLength;

                    if (receivedFileSize >= incomingFileSize) {
                        const blob = new Blob(incomingFileBuffer);
                        const url = URL.createObjectURL(blob);
                        const fileLink = `<a href="${url}" download="${incomingFile.fileName}" class="file-link">📁 ${incomingFile.fileName}</a>`;
                        appendChatMessage(targetName, fileLink, true);

                        // Reset file transfer state
                        incomingFile = null;
                        incomingFileBuffer = [];
                        receivedFileSize = 0;
                    }
                }
            };
        }

        function sendChatMessage() {
            const msg = chatTextEl.value.trim();
            if (!msg || !dataChannel || dataChannel.readyState !== 'open') return;

            const msgId = generateMsgId();
            const messageData = {
                type: 'chat',
                msg,
                msgId,
                sender: myName
            };

            dataChannel.send(JSON.stringify(messageData));
            appendChatMessage(myName, msg, true, msgId, 'sent');
            chatTextEl.value = '';
        }

        function appendChatMessage(sender, msg, save = true, msgId = '', status = '') {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isSelf = sender === myName;
            const messageClass = isSelf ? 'sent' : 'received';

            let statusIcon = '';
            if (isSelf && msgId) {
                statusIcon = status === 'read' ?
                    '<span class="message-status"><i class="fas fa-check-double"></i></span>' :
                    '<span class="message-status"><i class="fas fa-check"></i></span>';
            }

            let contentHtml = msg;

            // Detect if message is a file link
            if (msg.includes('<a href=') && msg.includes('download=')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(msg, 'text/html');
                const link = doc.querySelector('a');
                if (link) {
                    const fileName = link.getAttribute('download') || 'file';
                    const fileUrl = link.getAttribute('href');
                    contentHtml = `<a href="${fileUrl}" download="${fileName}" class="file-link">📁 <strong>${fileName}</strong></a>`;
                }
            }

            const messageElement = document.createElement('div');
            messageElement.className =` message ${messageClass}`;
            messageElement.innerHTML = `
                ${contentHtml}
                <div class="message-time">${time} ${statusIcon}</div>`
            ;

            if (msgId) {
                messageElement.dataset.msgId = msgId;
            }

            chatMessagesEl.appendChild(messageElement);
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

            if (save && msgId) {
                storeMessage(myName, targetName, sender, msg, msgId, status);
            }
        }

        function handleFileUpload() {
            const file = fileInput.files[0];
            if (!file || !dataChannel || dataChannel.readyState !== 'open') {
                showToast("File Error", "Cannot send file. Make sure you're connected.");
                return;
            }

            // Reset file input
            fileInput.value = '';

            // Send file metadata first
            const metadata = {
                fileName: file.name,
                fileSize: file.size
            };
            dataChannel.send(JSON.stringify(metadata));

            // Then send the file in chunks
            const chunkSize = 16 * 1024;
            const fileReader = new FileReader();
            let offset = 0;

            fileReader.onload = e => {
                dataChannel.send(e.target.result);
                offset += e.target.result.byteLength;

                if (offset < file.size) {
                    readSlice(offset);
                } else {
                    appendChatMessage(myName, `📤 Sent file: ${file.name}`, true);
                }
            };

            const readSlice = o => {
                const slice = file.slice(o, o + chunkSize);
                fileReader.readAsArrayBuffer(slice);
            };

            readSlice(0);
        }

        function loadChatHistory(me, other) {
            const key = `chat_${[me, other].sort().join('_')}`;
            const arr = JSON.parse(localStorage.getItem(key) || '[]');

            // Clear chat messages
            chatMessagesEl.innerHTML = '';

            if (arr.length === 0) {
                return;
            }

            // Group messages by date
            const messagesByDate = {};
            arr.forEach(message => {
                const date = new Date(message.time).toLocaleDateString();
                if (!messagesByDate[date]) {
                    messagesByDate[date] = [];
                }
                messagesByDate[date].push(message);
            });

            // Display messages with date dividers
            Object.entries(messagesByDate).forEach(([date, messages]) => {
                const dateDivider = document.createElement('div');
                dateDivider.className = 'text-center small text-muted my-3';
                dateDivider.textContent = date;
                chatMessagesEl.appendChild(dateDivider);

                messages.forEach(message => {
                    appendChatMessage(
                        message.sender,
                        message.msg,
                        false,
                        message.msgId,
                        message.status
                    );
                });
            });

            // Scroll to bottom
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }

        function startCall(user) {
            if (!hasMicrophone) {
                showToast('Microphone Required', 'Voice calls require microphone access');
                return;
            }

            targetName = user;

            // Update call UI
            callNameEl.textContent = user;
            callAvatarEl.textContent = user.substring(0, 2).toUpperCase();
            callStatusEl.textContent = 'Calling...';
            callTimerEl.textContent = '00:00';
            callContainer.classList.add('active');

            // Initialize peer connection
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

            pc.onicecandidate = e => {
                if (e.candidate) {
                    ws.send(JSON.stringify({
                        type: 'candidate',
                        from: myName,
                        to: targetName,
                        candidate: e.candidate
                    }));
                }
            };

            pc.ontrack = e => {
                const remoteAudio = document.getElementById('remoteAudio');
                if (e.streams && e.streams[0]) {
                    remoteAudio.srcObject = e.streams[0];

                    if (callStatusEl.textContent === 'Connecting...') {
                        callStatusEl.textContent = 'In Call';
                        callTimerEl.style.display = 'block';
                        startCallTimer();
                    }
                }
            };

            // Add local audio stream and create offer
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    const localAudio = document.getElementById('localAudio');
                    localAudio.srcObject = stream;

                    stream.getTracks().forEach(track => pc.addTrack(track, stream));

                    return pc.createOffer();
                })
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    ws.send(JSON.stringify({
                        type: 'offer',
                        from: myName,
                        to: targetName,
                        offer: pc.localDescription
                    }));
                })
                .catch(error => {
                    console.error('Error accessing microphone or creating offer:', error);
                    showToast("Call Error", "Could not start call. Check mic permissions.");
                    endCall();
                });
        }

        function handleIncomingCall(msg) {
            targetName = msg.from;

            // Update call UI
            callNameEl.textContent = msg.from;
            callAvatarEl.textContent = msg.from.substring(0, 2).toUpperCase();
            callStatusEl.textContent = 'Incoming Call';
            callTimerEl.style.display = 'none';
            callContainer.classList.add('active');

            // Add accept/reject buttons
            const callControls = document.querySelector('.call-controls');
            callControls.innerHTML = 
                `<button class="call-btn accept" id="acceptCallBtn">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="call-btn decline" id="rejectCallBtn">
                    <i class="fas fa-phone-slash"></i>
                </button>`
            ;

            document.getElementById('acceptCallBtn').addEventListener('click', () => answerCall(msg.offer));
            document.getElementById('rejectCallBtn').addEventListener('click', rejectCall);

            // Show notification
            showToast("Incoming Call", `${msg.from} is calling you`);
        }



        function answerCall(offer) {
            callStatusEl.textContent = 'Connecting...';

            // Update call controls
            const callControls = document.querySelector('.call-controls');
            callControls.innerHTML = 
        `<button class="call-btn end-call" id="endCallBtn">
            <i class="fas fa-phone"></i>
        </button>`
    ;
            document.getElementById('endCallBtn').addEventListener('click', endCall);

            // Initialize peer connection
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

            pc.onicecandidate = e => {
                if (e.candidate) {
                    ws.send(JSON.stringify({
                        type: 'candidate',
                        from: myName,
                        to: targetName,
                        candidate: e.candidate
                    }));
                }
            };

            pc.ontrack = e => {
                const remoteAudio = document.getElementById('remoteAudio');
                if (e.streams && e.streams[0]) {
                    remoteAudio.srcObject = e.streams[0];

                    if (callStatusEl.textContent === 'Connecting...') {
                        callStatusEl.textContent = 'In Call';
                        callTimerEl.style.display = 'block';
                        startCallTimer();
                    }
                }
            };

            queuedIceCandidates = []; // Clear ICE queue

            pc.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => {
                    return pc.createAnswer();
                })
                .then(answer => pc.setLocalDescription(answer))
                .then(() => {
                    ws.send(JSON.stringify({
                        type: 'answer',
                        from: myName,
                        to: targetName,
                        answer: pc.localDescription
                    }));

                    // Add local audio stream AFTER answer is sent
                    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                })
                .then(stream => {
                    const localAudio = document.getElementById('localAudio');
                    localAudio.srcObject = stream;
                    stream.getTracks().forEach(track => pc.addTrack(track, stream));
                })
                .catch(error => {
                    console.error('Error answering call:', error);
                    showToast("Call Error", "Could not answer the call");
                    endCall();
                });
        }







        function startCallTimer() {
            if (callTimer) clearInterval(callTimer); // Clear existing timer

            callStartTime = new Date();
            callTimer = setInterval(() => {
                const now = new Date();
                const diff = Math.floor((now - callStartTime) / 1000);
                const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
                const seconds = (diff % 60).toString().padStart(2, '0');
                callTimerEl.textContent = `${minutes}:${seconds}`;
            }, 1000);
        }

       function rejectCall() {
    if (targetName) {
        ws.send(JSON.stringify({
            type: 'call-ended',
            from: myName,
            to: targetName
        }));
    }
    endCall(); // Perform full cleanup
}

       function endCall() {
    // Send call-ended signal if target exists
    if (targetName) {
        ws.send(JSON.stringify({
            type: 'call-ended',
            from: myName,
            to: targetName
        }));
    }

    // Close peer connection
    if (pc) {
        pc.getSenders().forEach(sender => {
            if (sender.track) sender.track.stop();
        });
        pc.close();
        pc = null;
    }

    // Stop local audio stream
    const localAudio = document.getElementById('localAudio');
    if (localAudio.srcObject) {
        localAudio.srcObject.getTracks().forEach(track => track.stop());
        localAudio.srcObject = null;
    }

    // Stop remote audio stream
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio.srcObject) {
        remoteAudio.srcObject.getTracks().forEach(track => track.stop());
        remoteAudio.srcObject = null;
    }

    // Reset UI
    callStatusEl.textContent = 'Call Ended';
    callTimerEl.textContent = '00:00';
    callContainer.classList.remove('active');

    stopCallTimer();
    targetName = null;
}

        function generateMsgId() {
            return `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }

        function storeMessage(me, other, sender, msg, msgId, status = 'sent') {
            const key = `chat_${[me, other].sort().join('_')}`;
            const arr = JSON.parse(localStorage.getItem(key) || '[]');
            arr.push({
                sender,
                msg,
                time: new Date().toISOString(),
                msgId,
                status
            });
            localStorage.setItem(key, JSON.stringify(arr));
        }

        function updateUserList() {
            const users = JSON.parse(localStorage.getItem('latestUsers') || '[]');
            handleUserList(users);
        }

        function requestNotificationPermission() {
            if (!("Notification" in window)) {
                return;
            }

            if (Notification.permission === "default" || Notification.permission === "denied") {
                Notification.requestPermission();
            }
        }

        function showBrowserNotification(title, body) {
            if (Notification.permission === "granted") {
                new Notification(title, {
                    body: body,
                    icon: "https://cdn-icons-png.flaticon.com/512/1827/1827392.png"
                });
            }
        }

        function showToast(title, message) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerHTML = 
                `<div class="toast-icon">
                    <i class="fas fa-bell"></i>
                </div>
                <div class="toast-content">
                    <div class="toast-title">${title}</div>
                    <div class="toast-message">${message}</div>
                </div>`
            ;

            document.getElementById('toastContainer').appendChild(toast);

            // Remove toast after animation
            setTimeout(() => {
                toast.remove();
            }, 3000);
        }

        function saveCurrentDateTag() {
            localStorage.setItem('storageDate', new Date().toISOString().split('T')[0]);
        }

        function clearOldLocalStorage() {
            const storedDate = localStorage.getItem('storageDate');
            const today = new Date().toISOString().split('T')[0];

            if (storedDate !== today) {
                localStorage.clear();
            }
        }

        function handleIceCandidate(msg) {
            if (!pc) return;

            const candidate = new RTCIceCandidate(msg.candidate);

            if (!pc.remoteDescription || !pc.remoteDescription.type) {
                queuedIceCandidates.push(candidate);
            } else {
                pc.addIceCandidate(candidate).catch(err => {
                    console.warn("ICE candidate add failed:", err);
                });
            }
        }


        function handleCallAnswer(msg) {
            if (pc) {
                pc.setRemoteDescription(new RTCSessionDescription(msg.answer))
                    .then(() => {
                        processIceCandidateQueue();  // Process queued candidates
                        showToast("Call Connected", `Connected to ${targetName}`);
                    })
                    .catch(error => {
                        console.error('Error setting remote description:', error);
                        showToast('Call Error', 'Could not connect to call');
                        endCall();
                    });
            }
        }



        function handleCallRejected() {
            showToast("Call Rejected",` ${targetName} rejected your call`);
            endCall();
        }

        // WhatsApp-like mobile navigation
document.addEventListener('DOMContentLoaded', function() {
    // When a contact is clicked, activate chat view on mobile
    document.getElementById('contactsList').addEventListener('click', function(e) {
        if (window.innerWidth <= 576) {
            document.getElementById('appContainer').classList.add('chat-active');
        }
    });

    // Back button to return to contacts list
    document.getElementById('backToContacts').addEventListener('click', function() {
        document.getElementById('appContainer').classList.remove('chat-active');
    });
});