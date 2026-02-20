// Background script for Salesforce Record Insert Extension

chrome.runtime.onInstalled.addListener(() => {
    console.log("Salesforce Record Insert Extension installed.");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openTab") {
        chrome.tabs.create({
            url: chrome.runtime.getURL("pages/tab.html")
        });
        sendResponse({ status: "Tab opened" });
    } else if (request.action === "authenticate") {
        handleAuthentication()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep the message channel open for async response
    } else if (request.action === "getSessionInfo") {
        // Forward the request to the active Salesforce tab
        forwardToSalesforceTab(request, sendResponse);
        return true;
    } else if (request.action === "sessionCaptured") {
        // Session was captured by content script
        console.log('Session captured by content script:', request.sessionInfo);
        sendResponse({ status: "Session received" });
    }
});

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({
        url: chrome.runtime.getURL("pages/tab.html")
    });
});

async function handleAuthentication() {
    try {
        // First check if we have stored session information
        const stored = await chrome.storage.local.get(['sfToken', 'sfInstanceUrl', 'lastUpdated']);
        
        if (stored.sfToken && stored.sfInstanceUrl && stored.lastUpdated) {
            // Check if session is recent (less than 1 hour old)
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            if (stored.lastUpdated > oneHourAgo) {
                return {
                    success: true,
                    method: 'stored_session',
                    instanceUrl: stored.sfInstanceUrl
                };
            }
        }
        
        // Try to detect existing Salesforce sessions
        const existingSessions = await detectSalesforceSession();
        
        if (existingSessions.length > 0) {
            // Use existing session
            const session = existingSessions[0];
            await chrome.storage.local.set({
                sfToken: session.sessionId,
                sfInstanceUrl: session.serverUrl,
                lastUpdated: Date.now()
            });
            
            return {
                success: true,
                method: 'session_detection',
                instanceUrl: session.serverUrl
            };
        }
        
        // If no session found, return info for manual authentication
        return {
            success: false,
            error: 'No active Salesforce session found. Please log in to Salesforce first.',
            requiresManualAuth: true
        };
        
    } catch (error) {
        console.error('Authentication error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function detectSalesforceSession() {
    try {
        // First try storage-based detection (from content script)
        const stored = await chrome.storage.local.get(['sfToken', 'sfInstanceUrl', 'lastUpdated']);
        if (stored.sfToken && stored.sfInstanceUrl) {
            return [{
                sessionId: stored.sfToken,
                serverUrl: stored.sfInstanceUrl,
                method: 'storage_based'
            }];
        }
        
        // Fallback to script injection (with better error handling)
        return new Promise((resolve) => {
            chrome.tabs.query({}, (tabs) => {
                const salesforceTabs = tabs.filter(tab => 
                    tab.url && 
                    tab.id && 
                    tab.status === 'complete' && // Only complete tabs
                    !tab.url.startsWith('chrome://') && // Exclude chrome internal pages
                    !tab.url.startsWith('chrome-extension://') && // Exclude extension pages
                    (
                        tab.url.includes('.salesforce.com') || 
                        tab.url.includes('.force.com') ||
                        tab.url.includes('.lightning.force.com')
                    )
                );
                
                if (salesforceTabs.length === 0) {
                    resolve([]);
                    return;
                }
                
                // Try to extract session information from Salesforce tabs
                const sessions = [];
                let processed = 0;
                
                salesforceTabs.forEach(tab => {
                    try {
                        if (chrome.scripting && tab.id && tab.url) {
                            // Additional validation before script execution
                            if (tab.url.startsWith('https://') && 
                                (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
                                
                                chrome.scripting.executeScript({
                                    target: { tabId: tab.id },
                                    func: extractSalesforceSession
                                }).then((results) => {
                                    processed++;
                                    
                                    if (results && results[0] && results[0].result) {
                                        sessions.push(results[0].result);
                                    }
                                    
                                    if (processed === salesforceTabs.length) {
                                        resolve(sessions);
                                    }
                                }).catch((error) => {
                                    console.warn('Could not execute script on tab:', tab.url, '- Tab may not support script injection');
                                    processed++;
                                    if (processed === salesforceTabs.length) {
                                        resolve(sessions);
                                    }
                                });
                            } else {
                                // Skip invalid URLs
                                processed++;
                                if (processed === salesforceTabs.length) {
                                    resolve(sessions);
                                }
                            }
                        } else {
                            // Skip if no scripting API or invalid tab
                            processed++;
                            if (processed === salesforceTabs.length) {
                                resolve(sessions);
                            }
                        }
                    } catch (error) {
                        console.warn('Error validating tab for script execution:', error.message);
                        processed++;
                        if (processed === salesforceTabs.length) {
                            resolve(sessions);
                        }
                    }
                });
            });
        });
    } catch (error) {
        console.error('Error in detectSalesforceSession:', error);
        return [];
    }
}

async function forwardToSalesforceTab(request, sendResponse) {
    try {
        const tabs = await chrome.tabs.query({});
        const salesforceTabs = tabs.filter(tab => 
            tab.url && 
            tab.id && 
            tab.status === 'complete' &&
            !tab.url.startsWith('chrome://') &&
            !tab.url.startsWith('chrome-extension://') &&
            (
                tab.url.includes('.salesforce.com') || 
                tab.url.includes('.force.com')
            )
        );
        
        if (salesforceTabs.length > 0) {
            // Send message to the first valid Salesforce tab
            try {
                const targetTab = salesforceTabs[0];
                chrome.tabs.sendMessage(targetTab.id, request, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Tab message warning:', chrome.runtime.lastError.message);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse(response);
                    }
                });
            } catch (tabError) {
                console.warn('Error sending tab message:', tabError);
                sendResponse({ success: false, error: `Tab communication error: ${tabError.message}` });
            }
        } else {
            sendResponse({ success: false, error: 'No accessible Salesforce tabs found' });
        }
    } catch (error) {
        console.warn('Forward to tab error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

function extractSalesforceSession() {
    try {
        // Try to get session info from various sources
        let sessionId = null;
        let serverUrl = null;
        
        // Method 1: Check for session cookie
        if (document.cookie.includes('sid=')) {
            const sidMatch = document.cookie.match(/sid=([^;]+)/);
            if (sidMatch) {
                sessionId = sidMatch[1];
            }
        }
        
        // Method 2: Check window object for session info (Lightning)
        if (window.sforce || window.$Api) {
            try {
                if (window.sforce && window.sforce.connection) {
                    sessionId = window.sforce.connection.sessionId;
                    serverUrl = window.sforce.connection.serverUrl;
                }
            } catch (e) {
                // Silent fail
            }
        }
        
        // Method 3: Extract from current URL
        if (!serverUrl) {
            const url = new URL(window.location.href);
            if (url.hostname.includes('salesforce.com') || url.hostname.includes('force.com')) {
                serverUrl = `${url.protocol}//${url.hostname}`;
            }
        }
        
        // Method 4: Try to get from meta tags or other sources
        try {
            // Check if there's a session in localStorage or sessionStorage
            const storedSession = localStorage.getItem('session') || sessionStorage.getItem('session');
            if (storedSession && !sessionId) {
                const parsed = JSON.parse(storedSession);
                sessionId = parsed.sessionId || parsed.sid;
            }
        } catch (e) {
            // Silent fail
        }
        
        if (sessionId && serverUrl) {
            return {
                sessionId: sessionId,
                serverUrl: serverUrl,
                method: 'session_detection'
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error extracting session:', error);
        return null;
    }
}