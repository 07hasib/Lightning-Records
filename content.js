// Content script for Salesforce Record Insert Extension

// Prevent duplicate execution
if (window.sfRecordInsertExtensionLoaded) {
    return;
}
window.sfRecordInsertExtensionLoaded = true;

// Only run on Salesforce domains
if (window.location.hostname.includes('salesforce.com') || 
    window.location.hostname.includes('force.com')) {
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeExtension);
    } else {
        initializeExtension();
    }
    
    // Also try to auto-capture session on page load
    setTimeout(() => {
        captureAndStoreSession();
    }, 2000);
}

function initializeExtension() {
    // Add floating action button to Salesforce pages
    createFloatingButton();
    
    // Auto-capture session information
    captureAndStoreSession();
    
    // Set up periodic session monitoring
    setInterval(() => {
        captureAndStoreSession();
    }, 60000); // Check every minute
    
    // Listen for messages from extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "getSessionInfo") {
            const sessionInfo = extractSessionInfo();
            sendResponse(sessionInfo);
        }
    });
}

async function captureAndStoreSession() {
    try {
        const sessionInfo = extractSessionInfo();
        
        if (sessionInfo && sessionInfo.sessionId && sessionInfo.serverUrl) {
            // Store the session information for the extension to use
            await chrome.storage.local.set({
                sfToken: sessionInfo.sessionId,
                sfInstanceUrl: sessionInfo.serverUrl,
                lastUpdated: Date.now()
            });
            
            console.log('Salesforce session captured automatically');
            
            // Notify the extension that session is available
            try {
                chrome.runtime.sendMessage({
                    action: 'sessionCaptured',
                    sessionInfo: sessionInfo
                });
            } catch (msgError) {
                // Silent fail for messaging
                console.log('Session captured but could not notify extension');
            }
        } else {
            console.log('No valid Salesforce session found to capture');
        }
    } catch (error) {
        console.error('Error capturing session:', error);
    }
}

function createFloatingButton() {
    // Check if button already exists
    if (document.getElementById('sf-record-insert-fab')) {
        return;
    }
    
    const fab = document.createElement('div');
    fab.id = 'sf-record-insert-fab';
    fab.innerHTML = `
        <button class="sf-fab-btn" title="Open Record Insert Tool">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
        </button>
    `;
    
    // Add styles
    const styles = `
        #sf-record-insert-fab {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 10000;
        }
        
        .sf-fab-btn {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #0176d3 0%, #0d47a1 100%);
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(1, 118, 211, 0.4);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .sf-fab-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(1, 118, 211, 0.6);
        }
        
        .sf-fab-btn:active {
            transform: translateY(0);
        }
        
        @keyframes sf-fab-pulse {
            0% { box-shadow: 0 4px 12px rgba(1, 118, 211, 0.4); }
            50% { box-shadow: 0 4px 20px rgba(1, 118, 211, 0.8); }
            100% { box-shadow: 0 4px 12px rgba(1, 118, 211, 0.4); }
        }
        
        .sf-fab-btn.pulse {
            animation: sf-fab-pulse 2s infinite;
        }
    `;
    
    // Inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
    
    // Add click handler
    fab.querySelector('.sf-fab-btn').addEventListener('click', () => {
        // Capture session before opening tab
        captureAndStoreSession();
        chrome.runtime.sendMessage({ action: 'openTab' });
    });
    
    // Add to page
    document.body.appendChild(fab);
    
    // Add pulse animation on first load
    setTimeout(() => {
        fab.querySelector('.sf-fab-btn').classList.add('pulse');
        setTimeout(() => {
            fab.querySelector('.sf-fab-btn').classList.remove('pulse');
        }, 6000);
    }, 1000);
}

function extractSessionInfo() {
    try {
        let sessionId = null;
        let serverUrl = null;
        let orgId = null;
        let userId = null;
        
        // Try different methods to extract session information
        
        // Method 1: Check cookies (most reliable)
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'sid') {
                sessionId = value;
            } else if (name === 'oid') {
                orgId = value;
            }
        }
        
        // Method 2: Check global variables (Classic)
        if (window.sforce && window.sforce.connection) {
            sessionId = window.sforce.connection.sessionId || sessionId;
            serverUrl = window.sforce.connection.serverUrl || serverUrl;
        }
        
        // Method 3: Check for Lightning Experience
        if (window.$A && window.$A.get) {
            try {
                const context = window.$A.get("$Global.session");
                if (context) {
                    sessionId = context.sessionId || sessionId;
                }
            } catch (e) {
                // Silent fail
            }
        }
        
        // Method 4: Try to extract from window.location or other global objects
        try {
            // Check if there are any global variables with session info
            if (window.UserContext) {
                sessionId = window.UserContext.sessionId || sessionId;
                orgId = window.UserContext.orgId || orgId;
                userId = window.UserContext.userId || userId;
            }
            
            // Check for Lightning specific globals
            if (window.Lightning && window.Lightning.context) {
                const ctx = window.Lightning.context;
                sessionId = ctx.sessionId || sessionId;
                orgId = ctx.orgId || orgId;
                userId = ctx.userId || userId;
            }
        } catch (e) {
            // Silent fail
        }
        
        // Method 5: Extract from URL
        const url = new URL(window.location.href);
        if (!serverUrl) {
            serverUrl = `${url.protocol}//${url.hostname}`;
        }
        
        // Method 6: Check meta tags
        const metaTags = document.querySelectorAll('meta[name], meta[property]');
        for (let meta of metaTags) {
            const name = meta.getAttribute('name') || meta.getAttribute('property');
            const content = meta.getAttribute('content');
            
            if (name === 'salesforce-session-id' || name === 'sf:session-id') {
                sessionId = content;
            } else if (name === 'salesforce-server-url' || name === 'sf:server-url') {
                serverUrl = content;
            } else if (name === 'salesforce-org-id' || name === 'sf:org-id') {
                orgId = content;
            } else if (name === 'salesforce-user-id' || name === 'sf:user-id') {
                userId = content;
            }
        }
        
        // Method 7: Try to get from localStorage or sessionStorage
        try {
            const storageKeys = ['session', 'sfSession', 'salesforceSession', 'lightning'];
            for (let key of storageKeys) {
                const stored = localStorage.getItem(key) || sessionStorage.getItem(key);
                if (stored) {
                    try {
                        const parsed = JSON.parse(stored);
                        sessionId = sessionId || parsed.sessionId || parsed.sid || parsed.token;
                        orgId = orgId || parsed.orgId || parsed.organizationId;
                        userId = userId || parsed.userId;
                        serverUrl = serverUrl || parsed.serverUrl || parsed.instanceUrl;
                    } catch (e) {
                        // Not JSON, might be direct value
                        if (!sessionId && stored.length > 10) {
                            sessionId = stored;
                        }
                    }
                }
            }
        } catch (e) {
            // Silent fail
        }
        
        return {
            sessionId,
            serverUrl,
            orgId,
            userId,
            url: window.location.href,
            timestamp: Date.now(),
            method: 'content_script_extraction'
        };
        
    } catch (error) {
        console.error('Error extracting session info:', error);
        return null;
    }
}

// Helper function to detect Salesforce environment
function getSalesforceEnvironment() {
    const hostname = window.location.hostname;
    
    if (hostname.includes('lightning.force.com')) {
        return 'lightning';
    } else if (hostname.includes('salesforce.com')) {
        if (window.location.pathname.includes('/lightning/')) {
            return 'lightning';
        } else {
            return 'classic';
        }
    } else if (hostname.includes('force.com')) {
        return 'community';
    }
    
    return 'unknown';
}

// Monitor for session changes
let lastSessionCheck = null;
setInterval(() => {
    const currentSession = extractSessionInfo();
    if (currentSession && currentSession.sessionId && 
        (!lastSessionCheck || lastSessionCheck.sessionId !== currentSession.sessionId)) {
        captureAndStoreSession();
        lastSessionCheck = currentSession;
    }
}, 30000); // Check every 30 seconds

// Expose functions for debugging
window.SF_EXTENSION_DEBUG = {
    extractSessionInfo,
    getSalesforceEnvironment,
    captureAndStoreSession
};