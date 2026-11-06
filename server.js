const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Enable CORS for localhost convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // API Endpoint: Save / Add Story to stories.json
    if (pathname === '/api/save-story' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const newStory = JSON.parse(body);
                if (!newStory.title || !newStory.id || !Array.isArray(newStory.paragraphs)) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ error: 'Invalid story format. id, title, and paragraphs are required.' }));
                }

                const storiesPath = path.join(ROOT_DIR, 'stories.json');
                let stories = [];
                if (fs.existsSync(storiesPath)) {
                    try {
                        const content = fs.readFileSync(storiesPath, 'utf8');
                        stories = JSON.parse(content);
                        if (!Array.isArray(stories)) stories = [];
                        // Save backup
                        fs.writeFileSync(path.join(ROOT_DIR, 'stories.backup.json'), content, 'utf8');
                    } catch (e) {
                        stories = [];
                    }
                }

                // Check if story with same id already exists
                const existingIndex = stories.findIndex(s => s.id === newStory.id);
                if (existingIndex >= 0) {
                    stories[existingIndex] = newStory;
                } else {
                    stories.push(newStory);
                }

                // Write pretty formatted JSON with UTF-8
                const formattedJson = JSON.stringify(stories, null, 2);
                fs.writeFileSync(storiesPath, formattedJson, 'utf8');

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: existingIndex >= 0 ? 'গল্পটি সফলভাবে আপডেট করা হয়েছে!' : 'নতুন গল্পটি সফলভাবে যোগ করা হয়েছে!',
                    storyId: newStory.id,
                    totalStories: stories.length
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Failed to save story: ' + err.message }));
            }
        });
        return;
    }

    // Default route mapping
    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    } else if (pathname === '/generator') {
        pathname = '/generator.html';
    }

    let filePath = path.join(ROOT_DIR, pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Check 404.html
            const notFoundPath = path.join(ROOT_DIR, '404.html');
            if (fs.existsSync(notFoundPath)) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                return fs.createReadStream(notFoundPath).pipe(res);
            }
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`📖 গল্প সংকলন সার্ভার চালু হয়েছে!`);
    console.log(`🏠 ওয়েবসাইট:  http://localhost:${PORT}`);
    console.log(`⚙️ JSON জেনারেটর: http://localhost:${PORT}/generator.html`);
    console.log(`========================================\n`);
});

