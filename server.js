const express = require("express");
const path = require("path");
const WebSocket = require("ws");
const fs = require("fs");
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const PORT = 3000;
const WSPORT = 8080;

// ------------------ EXPRESS SERVER SETUP ------------------
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve static files

// ------------------ SIMPLE ROUTES ------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/overlay/chat", (req, res) => {
    res.sendFile(path.join(__dirname, "overlay_chat.html"));
});

app.get("/overlay/gift", (req, res) => {
    res.sendFile(path.join(__dirname, "overlay_gift.html"));
});

app.get("/overlay/sub", (req, res) => {
    res.sendFile(path.join(__dirname, "overlay_sub.html"));
});

// ------------------ TIKTOK LIVE CONNECTION ------------------
let tiktokLiveConnection = null;
let connectedUsername = null;

// Function to broadcast messages to all WebSocket clients
function broadcastToClients(message) {
    if (!wss) {
        console.log('❌ WebSocket server not ready');
        return;
    }
    
    let sentCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
            sentCount++;
        }
    });
    console.log(`📤 Sent ${message.type} to ${sentCount} clients`);
}

// Connect to TikTok Live
function connectToTikTokLive(username) {
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
    }

    tiktokLiveConnection = new WebcastPushConnection(username, {
        enableExtendedGiftInfo: true,
        processInitialData: true
    });

    tiktokLiveConnection.connect().then(state => {
        console.log(`✅ Connected to TikTok Live: ${state.roomId}`);
        connectedUsername = username;
        broadcastToClients({
            type: "tiktok_status",
            status: "connected",
            username: username
        });
    }).catch(err => {
        console.error('❌ Failed to connect to TikTok Live:', err.message);
        connectedUsername = null;
        broadcastToClients({
            type: "tiktok_status", 
            status: "disconnected",
            error: err.message
        });
    });

    // TikTok event handlers
    tiktokLiveConnection.on('chat', data => {
        console.log(`💬 ${data.uniqueId}: ${data.comment}`);
        broadcastToClients({
            type: "chat",
            user: data.uniqueId,
            message: data.comment
        });
    });

    tiktokLiveConnection.on('gift', data => {
        console.log(`🎁 ${data.uniqueId} sent gift: ${data.giftName}`);
        broadcastToClients({
            type: "gift",
            user: data.uniqueId,
            giftName: data.giftName
        });
    });

    tiktokLiveConnection.on('subscribe', data => {
        console.log(`⭐ ${data.uniqueId} subscribed!`);
        broadcastToClients({
            type: "sub",
            user: data.uniqueId
        });
    });

    tiktokLiveConnection.on('disconnected', () => {
        console.log('❌ Disconnected from TikTok Live');
        connectedUsername = null;
        broadcastToClients({ type: "tiktok_status", status: "disconnected" });
    });
}

// ------------------ API ROUTES ------------------
app.post("/api/tiktok/connect", (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Username is required" });
    }

    try {
        connectToTikTokLive(username);
        res.json({ success: true, message: `Connecting to @${username}...` });
    } catch (error) {
        res.status(500).json({ error: "Failed to connect: " + error.message });
    }
});

app.post("/api/tiktok/disconnect", (req, res) => {
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
        tiktokLiveConnection = null;
        connectedUsername = null;
        res.json({ success: true, message: "Disconnected" });
    } else {
        res.json({ success: false, message: "Not connected" });
    }
});

app.get("/api/tiktok/status", (req, res) => {
    res.json({
        connected: !!tiktokLiveConnection,
        username: connectedUsername
    });
});

// Test endpoint
app.get("/test", (req, res) => {
    broadcastToClients({
        type: "chat",
        user: "TestUser",
        message: "This is a test message from the server!"
    });
    res.json({ message: "Test message sent" });
});

// ------------------ START SERVERS ------------------
let httpServer;
let wss;

// Start HTTP server
try {
    httpServer = app.listen(PORT, '0.0.0.0', () => {
        console.log("🚀 HTTP Server Started Successfully!");
        console.log("📊 Dashboard: http://localhost:" + PORT);
        console.log("💬 Chat Overlay: http://localhost:" + PORT + "/overlay/chat");
        console.log("🎁 Gift Overlay: http://localhost:" + PORT + "/overlay/gift");
        console.log("⭐ Sub Overlay: http://localhost:" + PORT + "/overlay/sub");
        console.log("🧪 Test Page: http://localhost:" + PORT + "/test");
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use!`);
            console.log('💡 Try changing the PORT variable or close other applications using port 3000');
        } else {
            console.error('❌ HTTP Server error:', error);
        }
    });

} catch (error) {
    console.error('❌ Failed to start HTTP server:', error);
    process.exit(1);
}

// Start WebSocket server
try {
    wss = new WebSocket.Server({ port: WSPORT });
    console.log("🔌 WebSocket server running on ws://localhost:" + WSPORT);

    wss.on('connection', (ws) => {
        console.log('🔗 New client connected');
        
        // Send current status to new client
        if (connectedUsername) {
            ws.send(JSON.stringify({
                type: "tiktok_status",
                status: "connected",
                username: connectedUsername
            }));
        }

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('📨 Client message:', data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            console.log('🔌 Client disconnected');
        });
    });

    wss.on('error', (error) => {
        console.error('❌ WebSocket server error:', error);
    });

} catch (error) {
    console.error('❌ Failed to start WebSocket server:', error);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down servers...');
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
    }
    if (httpServer) {
        httpServer.close();
    }
    if (wss) {
        wss.close();
    }
    process.exit(0);
});

// ------------------ FILE UPLOAD CONFIGURATION ------------------
const multer = require('multer');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/stickers/');
    },
    filename: function (req, file, cb) {
        // Rename file to avoid conflicts
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}
if (!fs.existsSync('uploads/stickers')) {
    fs.mkdirSync('uploads/stickers', { recursive: true });
}

// ------------------ CHAT SETTINGS CONFIGURATION ------------------
let chatSettings = {
    fontSize: 16,
    showProfilePictures: true,
    textColor: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.7)",
    position: "bottom-right",
    customStickers: []
};

// Get chat settings
app.get("/api/chat/settings", (req, res) => {
    res.json(chatSettings);
});

// Update chat settings
app.post("/api/chat/settings", (req, res) => {
    chatSettings = { ...chatSettings, ...req.body };
    
    // Broadcast settings to all chat overlays
    broadcastToClients({
        type: "chat_settings",
        settings: chatSettings
    });
    
    res.json(chatSettings);
});

// Upload custom sticker
app.post("/api/chat/upload-sticker", upload.single('sticker'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }
    
    const sticker = {
        id: Date.now().toString(),
        name: req.body.name || "Custom Sticker",
        filename: req.file.filename,
        url: `/uploads/stickers/${req.file.filename}`
    };
    
    chatSettings.customStickers.push(sticker);
    
    // Broadcast updated settings
    broadcastToClients({
        type: "chat_settings", 
        settings: chatSettings
    });
    
    res.json({ success: true, sticker: sticker });
});

// Get uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Delete sticker
app.delete("/api/chat/sticker/:id", (req, res) => {
    const stickerId = req.params.id;
    const stickerIndex = chatSettings.customStickers.findIndex(s => s.id === stickerId);
    
    if (stickerIndex !== -1) {
        const sticker = chatSettings.customStickers[stickerIndex];
        
        // Delete file from filesystem
        try {
            fs.unlinkSync(path.join(__dirname, 'uploads', 'stickers', sticker.filename));
        } catch (error) {
            console.log('Could not delete file:', error.message);
        }
        
        chatSettings.customStickers.splice(stickerIndex, 1);
        
        // Broadcast updated settings
        broadcastToClients({
            type: "chat_settings",
            settings: chatSettings
        });
        
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Sticker not found" });
    }
});