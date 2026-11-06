/**
 * Telegram Analytics & Reader Tracker
 * Real-time monitoring: IP, City, ISP, Battery, Page Views, 20s Live Pulses, Reads & Time Spent.
 */
(function (window) {
    'use strict';

    // ================= CONFIGURATION =================
    const TG_BOT_TOKEN = '9006381036:AAFXHKLYNzi7eAlrA2FgyUuQrZrYy8AP5F0';
    const TG_CHAT_ID = '8313350444';
    const PULSE_INTERVAL_MS = 20000; // 20 seconds live update interval
    const MIN_READ_SECONDS_TO_REPORT = 3;

    // ================= STATE =================
    let visitorId = '';
    let isReturning = false;
    let visitCount = 1;
    let sessionStoriesReadCount = 0;
    let totalSessionActiveSeconds = 0;
    let totalSessionSeconds = 0; // includes background time
    let sessionStartTime = Date.now();
    let readHistory = [];

    let currentStory = null; // { id, title, startTs, activeSeconds, maxScrollPercent, reportedStart }
    let hasScrolledRecently = false;
    let pulseCount = 0;
    let pulseTimer = null;
    let secondTimer = null;
    let sessionSummarySent = false;

    // Visitor Geo & Device details cache
    let visitorGeo = {
        ip: 'লোড হচ্ছে...',
        city: 'অজানা',
        region: '',
        country: 'বাংলাদেশ',
        isp: 'অজানা'
    };

    // ================= HELPER FUNCTIONS =================
    function initVisitor() {
        try {
            let vid = localStorage.getItem('tg_story_vid');
            let visits = parseInt(localStorage.getItem('tg_story_visits') || '0', 10);
            if (!vid) {
                vid = 'user_' + Math.random().toString(36).substring(2, 9);
                localStorage.setItem('tg_story_vid', vid);
                visits = 1;
                isReturning = false;
            } else {
                visits += 1;
                isReturning = true;
            }
            localStorage.setItem('tg_story_visits', String(visits));
            visitorId = vid;
            visitCount = visits;
        } catch (e) {
            visitorId = 'anon_' + Math.random().toString(36).substring(2, 7);
        }
    }

    function formatDuration(totalSeconds) {
        if (!totalSeconds || totalSeconds < 1) return '0 সেকেন্ড';
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours} ঘণ্টা`);
        if (minutes > 0) parts.push(`${minutes} মিনিট`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds} সেকেন্ড`);
        return parts.join(' ');
    }

    function getDeviceInfo() {
        const ua = navigator.userAgent || '';
        let device = 'Desktop 💻';
        if (/Android/i.test(ua)) device = 'Android 📱';
        else if (/iPhone|iPad|iPod/i.test(ua)) device = 'iOS (iPhone) 📱';
        else if (/Mobile/i.test(ua)) device = 'Mobile 📱';
        else if (/Windows/i.test(ua)) device = 'Windows PC 💻';
        else if (/Macintosh/i.test(ua)) device = 'MacBook/Mac 💻';

        let browser = 'Browser';
        if (/Chrome/i.test(ua) && !/Edge|OPR/i.test(ua)) browser = 'Chrome';
        else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
        else if (/Firefox/i.test(ua)) browser = 'Firefox';
        else if (/Edge/i.test(ua)) browser = 'Edge';
        else if (/Opera|OPR/i.test(ua)) browser = 'Opera';

        const screenRes = `${window.screen.width}x${window.screen.height}`;
        return `${device} (${browser}, ${screenRes})`;
    }

    function getNetworkInfo() {
        if (navigator.connection && navigator.connection.effectiveType) {
            return navigator.connection.effectiveType.toUpperCase();
        }
        return 'Online';
    }

    async function getBatteryInfo() {
        try {
            if (navigator.getBattery) {
                const battery = await navigator.getBattery();
                const level = Math.round(battery.level * 100);
                const charging = battery.charging ? '⚡ চার্জ হচ্ছে' : '🔋 আনপ্লাগড';
                return `${level}% (${charging})`;
            }
        } catch (e) {}
        return 'তথ্য অনুপলব্ধ (N/A)';
    }

    function getReferrer() {
        if (!document.referrer) return 'সরাসরি প্রবেশ (Direct)';
        try {
            const url = new URL(document.referrer);
            return `${url.hostname} (${document.referrer.substring(0, 50)})`;
        } catch (e) {
            return document.referrer;
        }
    }

    function getBDTime() {
        return new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Dhaka',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }) + ' (BD)';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getCurrentScrollPercent() {
        const body = document.documentElement || document.body;
        const totalHeight = body.scrollHeight - window.innerHeight;
        if (totalHeight <= 0) return 0;
        const currentScroll = Math.max(0, window.scrollY || window.pageYOffset || 0);
        return Math.min(100, Math.round((currentScroll / totalHeight) * 100));
    }

    // ================= IP & GEO LOCATION =================
    async function fetchVisitorGeo() {
        try {
            const res = await fetch('https://ipwho.is/?t=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data && data.success !== false) {
                    visitorGeo = {
                        ip: data.ip || 'Unknown',
                        city: data.city || 'Unknown',
                        region: data.region || '',
                        country: data.country || 'Bangladesh',
                        isp: (data.connection && (data.connection.isp || data.connection.org)) || 'Unknown ISP'
                    };
                    return visitorGeo;
                }
            }
        } catch (e) {
            // Backup fetch using ipapi
            try {
                const res2 = await fetch('https://ipapi.co/json/');
                if (res2.ok) {
                    const data2 = await res2.json();
                    visitorGeo = {
                        ip: data2.ip || 'Unknown',
                        city: data2.city || 'Unknown',
                        region: data2.region || '',
                        country: data2.country_name || 'Bangladesh',
                        isp: data2.org || 'Unknown ISP'
                    };
                    return visitorGeo;
                }
            } catch (e2) {}
        }
        return visitorGeo;
    }

    // ================= TELEGRAM DISPATCHER =================
    async function sendTelegram(text, useKeepalive = false) {
        const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
        const payload = {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };

        const jsonStr = JSON.stringify(payload);

        if (useKeepalive) {
            try {
                if (window.fetch) {
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: jsonStr,
                        keepalive: true
                    }).catch(() => {});
                    return;
                }
            } catch (e) {}

            try {
                if (navigator.sendBeacon) {
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    navigator.sendBeacon(url, blob);
                    return;
                }
            } catch (e) {}
        }

        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: jsonStr
            });
        } catch (err) {
            console.warn('[Telegram Tracker] Dispatch failed:', err);
        }
    }

    // ================= 1. PAGE VIEW NOTIFICATION =================
    async function sendPageViewNotification() {
        await fetchVisitorGeo();
        const batteryText = await getBatteryInfo();

        const locationStr = [visitorGeo.city, visitorGeo.region, visitorGeo.country].filter(Boolean).join(', ');

        const msg = [
            `👀 <b>নতুন পেজ ভিজিট (New Page View)</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `👤 <b>ভিজিটর আইডি:</b> <code>${visitorId}</code> (${isReturning ? `পুরাতন - ${visitCount}ম ভিজিট` : 'নতুন ভিজিটর'})`,
            `🌐 <b>আইপি (IP):</b> <code>${visitorGeo.ip}</code>`,
            `📍 <b>লোকেশন:</b> ${locationStr}`,
            `🏢 <b>ISP / নেটওয়ার্ক:</b> ${visitorGeo.isp}`,
            `🔋 <b>ব্যাটারি লেভেল:</b> ${batteryText}`,
            `📶 <b>নেটওয়ার্ক টাইপ:</b> ${getNetworkInfo()}`,
            `📱 <b>ডিভাইস:</b> ${getDeviceInfo()}`,
            `🔗 <b>রেফারার:</b> ${getReferrer()}`,
            `⏰ <b>প্রবেশের সময়:</b> ${getBDTime()}`
        ].join('\n');

        sendTelegram(msg);
    }

    // ================= 2. 20-SECOND LIVE PULSE UPDATE =================
    async function sendPulseUpdate() {
        pulseCount += 1;
        const isTabActive = !document.hidden;
        const currentScroll = getCurrentScrollPercent();

        // Update story max scroll if in story
        if (currentStory && currentScroll > currentStory.maxScrollPercent) {
            currentStory.maxScrollPercent = currentScroll;
        }

        // Scrolling state
        let scrollStatusText = '';
        if (hasScrolledRecently) {
            scrollStatusText = `📜 স্ক্রল করছেন (বর্তমানে: ${currentScroll}%)`;
        } else {
            scrollStatusText = `⏸️ স্ক্রল করছেন না / স্থির (বর্তমানে: ${currentScroll}%)`;
        }
        hasScrolledRecently = false; // Reset for next 20s window

        // Tab state
        const tabStatus = isTabActive
            ? '✅ পেজে সক্রিয়ভাবে আছেন (Active Tab)'
            : '⚠️ ব্যাকগ্রাউন্ডে / অন্য ট্যাবে চলে গেছেন (Hidden Tab)';

        const batteryText = await getBatteryInfo();

        let locationOrStory = '';
        if (currentStory) {
            const isCompleted = currentStory.maxScrollPercent >= 80;
            const progress = isCompleted ? '✅ সম্পূর্ণ পড়া হয়েছে' : `⏳ ${currentStory.maxScrollPercent}% পড়া হয়েছে`;

            locationOrStory = [
                `📚 <b>গল্প:</b> ${escapeHtml(currentStory.title)}`,
                `⏳ <b>গল্পে সময়:</b> <b>${formatDuration(currentStory.activeSeconds)}</b>`,
                `📊 <b>পড়ার অগ্রগতি:</b> ${progress}`
            ].join('\n');
        } else {
            locationOrStory = `🏠 <b>অবস্থান:</b> হোম পেজ (গল্পের তালিকা দেখছেন)`;
        }

        const msg = [
            `📡 <b>লাইভ আপডেট (Live 20s Pulse #${pulseCount})</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `👤 <b>ভিজিটর:</b> <code>${visitorId}</code> (${visitorGeo.city || 'BD'})`,
            `👀 <b>অবস্থা:</b> ${tabStatus}`,
            `${locationOrStory}`,
            `📜 <b>স্ক্রলিং:</b> ${scrollStatusText}`,
            `🕐 <b>সাইটে মোট সময়:</b> ${formatDuration(totalSessionActiveSeconds)}`,
            `🔋 <b>ব্যাটারি:</b> ${batteryText}`,
            `⏰ <b>সময়:</b> ${getBDTime()}`
        ].join('\n');

        sendTelegram(msg);
    }

    // ================= 3. STORY EVENTS =================
    function onStoryOpen(storyId, storyTitle) {
        if (currentStory && currentStory.id !== storyId) {
            onStoryLeave('নতুন গল্পে গেছেন');
        }

        sessionStoriesReadCount += 1;
        currentStory = {
            id: storyId,
            title: storyTitle,
            startTs: Date.now(),
            activeSeconds: 0,
            maxScrollPercent: 0,
            reportedStart: true
        };

        const msg = [
            `📖 <b>গল্প পড়া শুরু (Story Opened)</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📚 <b>গল্প:</b> ${escapeHtml(storyTitle)}`,
            `🔢 <b>সেশন রিড:</b> ${sessionStoriesReadCount} তম গল্প`,
            `👤 <b>ভিজিটর:</b> <code>${visitorId}</code> (${visitorGeo.ip})`,
            `📍 <b>লোকেশন:</b> ${visitorGeo.city}, ${visitorGeo.country}`,
            `⏰ <b>শুরুর সময়:</b> ${getBDTime()}`
        ].join('\n');

        sendTelegram(msg);
    }

    function onStoryLeave(reason = 'হোম পেজে ফিরে গেছেন') {
        if (!currentStory) return;

        const currentScroll = getCurrentScrollPercent();
        if (currentScroll > currentStory.maxScrollPercent) {
            currentStory.maxScrollPercent = currentScroll;
        }

        const spent = currentStory.activeSeconds;
        const storyTitle = currentStory.title;
        const scroll = currentStory.maxScrollPercent;

        if (spent >= MIN_READ_SECONDS_TO_REPORT) {
            const isCompleted = scroll >= 80;
            const progressStatus = isCompleted ? '✅ সম্পূর্ণ পড়া হয়েছে' : `⏳ আংশিক পড়া হয়েছে (${scroll}%)`;

            readHistory.push({
                title: storyTitle,
                spentSec: spent,
                progress: scroll,
                isCompleted: isCompleted
            });

            const msg = [
                `⏱️ <b>পড়ার পরিসংখ্যান (Story Read Stats)</b>`,
                `━━━━━━━━━━━━━━━━━━━━`,
                `📚 <b>গল্প:</b> ${escapeHtml(storyTitle)}`,
                `⏳ <b>ব্যয়কৃত সময় (Time Spent):</b> <b>${formatDuration(spent)}</b>`,
                `📊 <b>পড়ার অগ্রগতি:</b> ${progressStatus}`,
                `📈 <b>সর্বোচ্চ স্ক্রল:</b> ${scroll}%`,
                `🔢 <b>মোট সেশন রিড:</b> ${sessionStoriesReadCount} টি গল্প`,
                `🕐 <b>সাইটে মোট সময়:</b> ${formatDuration(totalSessionActiveSeconds)}`,
                `ℹ️ <b>অবস্থা:</b> ${reason}`
            ].join('\n');

            sendTelegram(msg);
        }

        currentStory = null;
    }

    // ================= 4. SESSION EXIT =================
    function onSessionEnd() {
        if (sessionSummarySent) return;

        if (currentStory) {
            const currentScroll = getCurrentScrollPercent();
            if (currentScroll > currentStory.maxScrollPercent) {
                currentStory.maxScrollPercent = currentScroll;
            }
            const spent = currentStory.activeSeconds;
            if (spent >= MIN_READ_SECONDS_TO_REPORT) {
                readHistory.push({
                    title: currentStory.title,
                    spentSec: spent,
                    progress: currentStory.maxScrollPercent,
                    isCompleted: currentStory.maxScrollPercent >= 80
                });
            }
        }

        if (totalSessionSeconds < 5 && sessionStoriesReadCount === 0) {
            return;
        }

        sessionSummarySent = true;

        let historyText = '';
        if (readHistory.length > 0) {
            historyText = '\n\n📋 <b>পড়া গল্পসমূহ:</b>\n' + readHistory.map((item, idx) => {
                const badge = item.isCompleted ? '✅' : '⏳';
                return `${idx + 1}. ${badge} ${escapeHtml(item.title)} — <i>${formatDuration(item.spentSec)} (${item.progress}%)</i>`;
            }).join('\n');
        }

        const msg = [
            `🚪 <b>ভিজিটর সেশন সমাপ্ত (Session Ended)</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `👤 <b>ভিজিটর:</b> <code>${visitorId}</code> (${visitorGeo.ip})`,
            `📍 <b>লোকেশন:</b> ${visitorGeo.city}, ${visitorGeo.country}`,
            `📚 <b>মোট পঠিত গল্প:</b> <b>${sessionStoriesReadCount} টি</b>`,
            `⏳ <b>মোট ব্যয়কৃত সময়:</b> <b>${formatDuration(totalSessionActiveSeconds)}</b>`,
            `⏰ <b>শেষ সময়:</b> ${getBDTime()}`,
            historyText
        ].join('\n');

        sendTelegram(msg, true);
    }

    // ================= TIMERS & LISTENERS =================
    function startTimers() {
        // Active seconds counter (every 1 second)
        secondTimer = setInterval(() => {
            totalSessionSeconds += 1;
            if (!document.hidden) {
                totalSessionActiveSeconds += 1;
                if (currentStory) {
                    currentStory.activeSeconds += 1;
                }
            }
        }, 1000);

        // 20-second live status pulse
        pulseTimer = setInterval(() => {
            sendPulseUpdate();
        }, PULSE_INTERVAL_MS);
    }

    function init() {
        initVisitor();
        startTimers();

        // Send initial Page View Notification
        sendPageViewNotification();

        // Listen for scroll activity
        window.addEventListener('scroll', () => {
            hasScrolledRecently = true;
            if (currentStory) {
                const p = getCurrentScrollPercent();
                if (p > currentStory.maxScrollPercent) {
                    currentStory.maxScrollPercent = p;
                }
            }
        }, { passive: true });

        // Visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (currentStory) {
                    const p = getCurrentScrollPercent();
                    if (p > currentStory.maxScrollPercent) currentStory.maxScrollPercent = p;
                }
            }
        });

        // Unload / Tab close
        window.addEventListener('pagehide', onSessionEnd);
        window.addEventListener('beforeunload', onSessionEnd);
    }

    // Run on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    window.TelegramTracker = {
        onStoryOpen: onStoryOpen,
        onStoryLeave: onStoryLeave,
        onSessionEnd: onSessionEnd,
        getStats: function () {
            return {
                visitorId: visitorId,
                totalActiveSeconds: totalSessionActiveSeconds,
                sessionStoriesReadCount: sessionStoriesReadCount,
                currentStory: currentStory,
                readHistory: readHistory,
                geo: visitorGeo
            };
        }
    };

})(window);
