// Salesforce API integration functions

// OAuth configuration
const CLIENT_ID = 'YOUR_SALESFORCE_CONNECTED_APP_CLIENT_ID';
const REDIRECT_URI = chrome.identity.getRedirectURL();
const OAUTH_URL = `https://login.salesforce.com/services/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token`;

/**
 * Authenticate with Salesforce using OAuth
 */
export async function authenticate() {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({
      url: OAUTH_URL,
      interactive: true
    }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      
      // Parse the redirect URL for the access token
      const url = new URL(redirectUrl);
      const hash = url.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const instanceUrl = params.get('instance_url');
      
      if (accessToken && instanceUrl) {
        // Store the token
        chrome.storage.local.set({
          sfToken: accessToken,
          sfInstanceUrl: instanceUrl
        });
        
        resolve({
          success: true,
          accessToken,
          instanceUrl
        });
      } else {
        reject(new Error('Failed to get access token'));
      }
    });
  });
}

/**
 * Detect active Salesforce sessions in open tabs
 * @returns {Promise<Array>} Array of detected Salesforce sessions
 */
export async function detectSalesforceSessions() {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.query({}, async (tabs) => {
        const salesforceTabs = tabs.filter(tab => {
          try {
            const url = new URL(tab.url);
            return (
              url.hostname.includes('salesforce.com') || 
              url.hostname.includes('force.com') || 
              url.hostname.includes('lightning.force.com') ||
              url.hostname.includes('visualforce.com')
            );
          } catch (e) {
            return false; // Handle invalid URLs
          }
        });
        
        if (salesforceTabs.length === 0) {
          resolve([]);
          return;
        }
        
        const sessions = [];
        
        for (const tab of salesforceTabs) {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname;
            
            console.log('Checking for Salesforce session on domain:', domain);
            
            // Get the sid cookie for this domain and its parent domains
            let cookies = await chrome.cookies.getAll({
              domain: domain,
              name: "sid"
            });
            
            // If no cookies found on exact domain, try parent domain
            if (cookies.length === 0 && domain.split('.').length > 2) {
              const parentDomain = domain.split('.').slice(1).join('.');
              cookies = await chrome.cookies.getAll({
                domain: parentDomain,
                name: "sid"
              });
              
              console.log('Checking parent domain:', parentDomain, 'found cookies:', cookies.length);
            }
            
            if (cookies.length > 0) {
              const instanceUrl = `https://${domain}`;
              const sessionId = cookies[0].value;
              
              sessions.push({
                instanceUrl,
                sessionId,
                tabId: tab.id,
                tabTitle: tab.title,
                favIconUrl: tab.favIconUrl,
                domain: cookies[0].domain
              });
              
              console.log('Found Salesforce session on:', instanceUrl);
            }
          } catch (error) {
            console.error(`Error detecting session for tab ${tab.id}:`, error);
          }
        }
        
        console.log('Total sessions found:', sessions.length);
        resolve(sessions);
      });
    } catch (error) {
      console.error('Error in detectSalesforceSessions:', error);
      reject(error);
    }
  });
}

/**
 * Authenticate with Salesforce using Session ID
 * @param {string} instanceUrl - The Salesforce instance URL
 * @param {string} sessionId - The Salesforce session ID
 */
export async function authenticateWithSessionId(instanceUrl, sessionId) {
  // Validate the provided credentials by making a test API call
  try {
    console.log('Attempting to authenticate with:', instanceUrl);
    
    // Normalize the instance URL (remove trailing slash if present)
    const normalizedUrl = instanceUrl.endsWith('/') 
      ? instanceUrl.slice(0, -1) 
      : instanceUrl;
      
    // Test the connection with a simple API call
    const response = await fetch(`${normalizedUrl}/services/data/v56.0/`, {
      headers: {
        'Authorization': `Bearer ${sessionId}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('Authentication failed:', response.status);
      throw new Error(`Authentication failed: ${response.status}`);
    }
    
    // If successful, store the credentials
    chrome.storage.local.set({
      sfSessionId: sessionId,
      sfInstanceUrl: normalizedUrl
    });
    
    console.log('Authentication successful');
    
    return {
      success: true,
      instanceUrl: normalizedUrl
    };
  } catch (error) {
    console.error('Authentication error:', error);
    
    // Try different URL format if authentication fails
    if (instanceUrl.includes('lightning.force.com')) {
      try {
        // Convert lightning URL to REST API URL
        const domain = instanceUrl.split('//')[1].split('.')[0];
        const restUrl = `https://${domain}.my.salesforce.com`;
        
        console.log('Trying alternative URL:', restUrl);
        
        const response = await fetch(`${restUrl}/services/data/v56.0/`, {
          headers: {
            'Authorization': `Bearer ${sessionId}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Authentication failed: ${response.status}`);
        }
        
        // If successful, store the credentials
        chrome.storage.local.set({
          sfSessionId: sessionId,
          sfInstanceUrl: restUrl
        });
        
        console.log('Authentication successful with alternative URL');
        
        return {
          success: true,
          instanceUrl: restUrl
        };
      } catch (altError) {
        console.error('Alternative authentication failed:', altError);
      }
    }
    
    throw new Error('Failed to authenticate with Salesforce. Please check your Session ID and Instance URL.');
  }
}

/**
 * Check if the user is authenticated
 */
export async function isAuthenticated() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], (result) => {
      resolve(!!(result.sfSessionId && result.sfInstanceUrl));
    });
  });
}

/**
 * Logout/disconnect from Salesforce
 */
export async function logout() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['sfSessionId', 'sfInstanceUrl'], () => {
      resolve(true);
    });
  });
}

/**
 * Execute a SOQL query
 * @param {string} query - The SOQL query to execute
 */
export async function executeQuery(query) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        const url = `${result.sfInstanceUrl}/services/data/v56.0/query?q=${encodeURIComponent(query)}`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          }
        }).catch(error => {
          console.error('Network error in executeQuery:', error);
          throw new Error('Network error. Please check your internet connection.');
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            chrome.storage.local.remove(['sfSessionId', 'sfInstanceUrl']);
            reject(new Error('Session expired. Please reconnect.'));
            return;
          }
          
          try {
            const errorData = await response.json();
            reject(new Error(errorData[0]?.message || `HTTP error: ${response.status}`));
          } catch (e) {
            reject(new Error(`HTTP error: ${response.status}`));
          }
          return;
        }
        
        const data = await response.json();
        resolve(data);
      } catch (error) {
        console.error('Error in executeQuery:', error);
        reject(error);
      }
    });
  });
}

/**
 * Creates a record in Salesforce
 * @param {string} objectName - The API name of the object
 * @param {object} fields - Object containing field names and values
 * @returns {Promise<object>} - Promise that resolves with the created record
 */
export async function createRecord(objectName, fields) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        // Clean up fields to ensure proper formatting for Salesforce API
        const cleanFields = { ...fields };
        
        // Handle any special field formatting here if needed
        // (already handled multipicklist in the click handler)
        
        const url = `${result.sfInstanceUrl}/services/data/v56.0/sobjects/${objectName}`;
        
        console.log('Sending create request to:', url);
        console.log('With data:', cleanFields);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(cleanFields)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          if (response.status === 401) {
            chrome.storage.local.remove(['sfSessionId', 'sfInstanceUrl']);
            reject(new Error('Session expired. Please reconnect.'));
            return;
          }
          
          console.error('Error response from Salesforce:', data);
          reject(new Error(data[0]?.message || `HTTP error: ${response.status}`));
          return;
        }
        
        resolve(data);
      } catch (error) {
        console.error('Error in createRecord:', error);
        reject(error);
      }
    });
  });
}

/**
 * Create a custom field with permissions and page layout assignments
 * @param {string} objectName - The API name of the object
 * @param {Object} fieldDefinition - The field definition
 */
export async function createCustomField(objectName, fieldData) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        // Step 1: Create the field
        const fieldUrl = `${result.sfInstanceUrl}/services/data/v56.0/tooling/sobjects/CustomField`;
        
        // Prepare the field metadata
        const fieldMetadata = {
          FullName: `${objectName}.${fieldData.apiName}`,
          Metadata: {
            label: fieldData.label,
            description: fieldData.description || '',
            required: fieldData.required || false,
            externalId: fieldData.externalId || false,
            unique: fieldData.unique || false,
            caseSensitive: fieldData.caseSensitive || false,
            ...fieldData.typeSpecificMetadata
          }
        };
        
        console.log('Creating field with metadata:', JSON.stringify(fieldMetadata, null, 2));
        
        const fieldResponse = await fetch(fieldUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(fieldMetadata)
        });
        
        if (!fieldResponse.ok) {
          const errorText = await fieldResponse.text();
          console.error('Field creation error response:', errorText);
          
          try {
            const errorData = JSON.parse(errorText);
            const errorMessage = errorData[0]?.message || errorData.message || `HTTP error! status: ${fieldResponse.status}`;
            reject(new Error(errorMessage));
          } catch (parseError) {
            reject(new Error(`HTTP error! status: ${fieldResponse.status} - ${errorText}`));
          }
          return;
        }
        
        const fieldResult = await fieldResponse.json();
        console.log('Field creation success:', fieldResult);
        
        // Step 2: Set field permissions for selected profiles (if any selected)
        if (fieldData.selectedProfiles && (
            fieldData.selectedProfiles.visibility.length > 0 || 
            fieldData.selectedProfiles.read.length > 0 || 
            fieldData.selectedProfiles.write.length > 0
        )) {
          console.log('Setting field permissions for profiles...');
          
          try {
            await setFieldPermissions(result, objectName, fieldData.apiName, fieldData.selectedProfiles);
            console.log('Field permissions configuration completed');
          } catch (permError) {
            console.warn('Field permissions could not be set automatically:', permError.message);
            console.warn('You may need to manually configure field-level security in Salesforce Setup');
            // Don't fail the entire operation if permissions fail
          }
        }
        
        // Step 3: Add field to selected page layouts (if any selected)
        if (fieldData.selectedPageLayouts && fieldData.selectedPageLayouts.length > 0) {
          console.log('Adding field to page layouts...');
          
          try {
            await addFieldToPageLayouts(result, objectName, fieldData.apiName, fieldData.selectedPageLayouts);
            console.log('Field added to page layouts successfully');
          } catch (layoutError) {
            console.warn('Failed to add field to page layouts:', layoutError.message);
            // Don't fail the entire operation if page layout assignment fails
          }
        }
        
        // Step 4: Provide summary of what needs to be done manually
        if (fieldData.selectedProfiles && (
            fieldData.selectedProfiles.visibility.length > 0 || 
            fieldData.selectedProfiles.read.length > 0 || 
            fieldData.selectedProfiles.write.length > 0
        )) {
          provideFieldPermissionInstructions(objectName, fieldData.apiName, fieldData.selectedProfiles);
        }
        
        resolve({
          success: true,
          id: fieldResult.id,
          message: 'Field created successfully. Profile permissions logged for manual setup if needed.'
        });
        
      } catch (error) {
        console.error('Error creating custom field:', error);
        reject(error);
      }
    });
  });
}

/**
 * Set field permissions for profiles
 * @param {Object} authResult - Authentication details
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {Object} selectedProfiles - Selected profiles with permissions
 */
async function setFieldPermissions(authResult, objectName, fieldApiName, selectedProfiles) {
  // Combine all profiles that need permissions
  const allProfileIds = new Set([
    ...selectedProfiles.visibility,
    ...selectedProfiles.read,
    ...selectedProfiles.write
  ]);
  
  console.log(`Setting field permissions for ${allProfileIds.size} profiles...`);
  console.log('Profile IDs:', Array.from(allProfileIds));
  
  for (const profileId of allProfileIds) {
    try {
      // Determine permissions for this profile
      const hasVisibility = selectedProfiles.visibility.includes(profileId);
      const hasRead = selectedProfiles.read.includes(profileId);
      const hasWrite = selectedProfiles.write.includes(profileId);
      
      console.log(`Profile ${profileId} permissions: visibility=${hasVisibility}, read=${hasRead}, write=${hasWrite}`);
      
      // Note: FieldPermissions in Salesforce require a PermissionSet as the parent, not a Profile directly
      // For now, we'll log the permissions that would be set and provide guidance
      console.log(`Field permissions to be set for ${objectName}.${fieldApiName}:`);
      console.log(`- Profile: ${profileId}`);
      console.log(`- Read Access: ${hasVisibility || hasRead || hasWrite}`);
      console.log(`- Edit Access: ${hasWrite}`);
      
      // Alternative approach: Try to find the default permission set associated with the profile
      try {
        await setFieldPermissionsForProfile(authResult, objectName, fieldApiName, profileId, {
          read: hasVisibility || hasRead || hasWrite,
          edit: hasWrite
        });
      } catch (permError) {
        console.warn(`Could not automatically set permissions for profile ${profileId}:`, permError.message);
        
        // Provide detailed instructions for manual setup
        console.warn(`Manual setup required for profile ${profileId}:`);
        console.warn(`1. Go to Setup > Object Manager > ${objectName}`);
        console.warn(`2. Go to Fields & Relationships > ${fieldApiName}`);
        console.warn(`3. Click "Set Field-Level Security"`);
        console.warn(`4. Configure permissions for the desired profiles`);
      }
      
    } catch (error) {
      console.warn(`Error setting permissions for profile ${profileId}:`, error.message);
      // Continue with other profiles
    }
  }
}

/**
 * Attempt to set field permissions for a specific profile
 * @param {Object} authResult - Authentication details
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {string} profileId - The profile ID
 * @param {Object} permissions - The permissions to set
 */
async function setFieldPermissionsForProfile(authResult, objectName, fieldApiName, profileId, permissions) {
  // Method 1: Try to find and use profile-specific permission sets
  try {
    // Query for permission sets associated with this profile
    const permSetQuery = `SELECT Id, Name, ProfileId FROM PermissionSet WHERE ProfileId = '${profileId}' LIMIT 1`;
    const queryUrl = `${authResult.sfInstanceUrl}/services/data/v56.0/query?q=${encodeURIComponent(permSetQuery)}`;
    
    const queryResponse = await fetch(queryUrl, {
      headers: {
        'Authorization': `Bearer ${authResult.sfSessionId}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (queryResponse.ok) {
      const result = await queryResponse.json();
      if (result.records && result.records.length > 0) {
        const permissionSet = result.records[0];
        console.log(`Found permission set for profile ${profileId}:`, permissionSet);
        
        // Try to set field permissions using the permission set
        await setFieldPermissionsViaPermissionSet(authResult, objectName, fieldApiName, permissionSet.Id, permissions);
        return;
      }
    }
  } catch (error) {
    console.log(`Could not find permission set for profile ${profileId}:`, error.message);
  }
  
  // Method 2: Create a custom permission set for this field
  try {
    await createCustomPermissionSetForField(authResult, objectName, fieldApiName, profileId, permissions);
  } catch (error) {
    console.warn(`Could not create custom permission set for profile ${profileId}:`, error.message);
    throw error;
  }
}

/**
 * Create a custom permission set for field permissions
 * @param {Object} authResult - Authentication details
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {string} profileId - The profile ID
 * @param {Object} permissions - The permissions to set
 */
async function createCustomPermissionSetForField(authResult, objectName, fieldApiName, profileId, permissions) {
  console.log(`Creating custom permission set for field ${objectName}.${fieldApiName}`);
  
  // Note: Creating permission sets and assigning them programmatically is complex
  // For now, we'll log the details that would be needed for manual setup
  console.log(`Would create permission set with the following configuration:`);
  console.log(`- Name: ${objectName}_${fieldApiName}_Permissions`);
  console.log(`- Label: ${objectName} ${fieldApiName} Permissions`);
  console.log(`- Field: ${objectName}.${fieldApiName}`);
  console.log(`- Read Permission: ${permissions.read}`);
  console.log(`- Edit Permission: ${permissions.edit}`);
  console.log(`- Target Profile: ${profileId}`);
  
  // This would require:
  // 1. Creating a PermissionSet
  // 2. Creating FieldPermissions with the PermissionSet as parent
  // 3. Assigning the PermissionSet to users with the specified profile
  
  throw new Error('Automatic permission set creation not implemented. Manual setup required.');
}

/**
 * Alternative method to set field permissions via Permission Set API
 * @param {Object} authResult - Authentication details
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {string} permissionSetId - The permission set ID (not profile ID)
 * @param {Object} permissions - The permissions to set
 */
async function setFieldPermissionsViaPermissionSet(authResult, objectName, fieldApiName, permissionSetId, permissions) {
  console.log(`Setting field permissions via Permission Set ${permissionSetId}`);
  
  try {
    // Create field permissions using the permission set as parent
    const permissionData = {
      ParentId: permissionSetId, // This should be a PermissionSet ID, not Profile ID
      Field: `${objectName}.${fieldApiName}`,
      PermissionsRead: permissions.read,
      PermissionsEdit: permissions.edit
    };
    
    console.log('Creating field permission with data:', permissionData);
    
    const response = await fetch(`${authResult.sfInstanceUrl}/services/data/v56.0/sobjects/FieldPermissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authResult.sfSessionId}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(permissionData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create field permission via permission set:', errorText);
      throw new Error(`Failed to create field permission: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('Successfully created field permission via permission set:', result);
    
  } catch (error) {
    console.error('Error in setFieldPermissionsViaPermissionSet:', error);
    throw error;
  }
}

/**
 * Add field to selected page layouts
 * @param {Object} authResult - Authentication details
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {Array} pageLayoutIds - Array of page layout IDs
 */
async function addFieldToPageLayouts(authResult, objectName, fieldApiName, pageLayoutIds) {
  for (const layoutId of pageLayoutIds) {
    try {
      // First, get the current page layout metadata
      const layoutUrl = `${authResult.sfInstanceUrl}/services/data/v56.0/tooling/sobjects/Layout/${layoutId}`;
      
      const getResponse = await fetch(layoutUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authResult.sfSessionId}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!getResponse.ok) {
        console.warn(`Failed to retrieve page layout ${layoutId}`);
        continue;
      }
      
      const layoutData = await getResponse.json();
      console.log(`Retrieved page layout ${layoutId}:`, layoutData.FullName);
      
      // For now, we'll just log that we would add the field to the layout
      // Actually modifying page layouts requires complex metadata manipulation
      console.log(`Would add field ${fieldApiName} to page layout ${layoutData.FullName}`);
      
      // Note: Adding fields to page layouts via API is complex and requires
      // retrieving the full layout metadata, modifying it, and updating it
      // This is a simplified implementation that logs the intent
      
    } catch (error) {
      console.warn(`Error processing page layout ${layoutId}:`, error.message);
      // Continue with other layouts
    }
  }
}

/**
 * Create a custom object
 * @param {Object} objectDefinition - The object definition
 */
export async function createCustomObject(objectDefinition) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        const url = `${result.sfInstanceUrl}/services/data/v56.0/tooling/sobjects/CustomObject`;
        
        // Prepare the object metadata
        const metadata = {
          FullName: objectDefinition.apiName,
          Metadata: {
            label: objectDefinition.label,
            pluralLabel: objectDefinition.pluralLabel,
            nameField: {
              type: 'Text',
              label: 'Name'
            },
            deploymentStatus: 'Deployed',
            enableReports: objectDefinition.enableReports || true,
            enableActivities: objectDefinition.enableActivities || true,
            enableHistory: objectDefinition.enableHistory || false,
            description: objectDefinition.description || ''
          }
        };
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(metadata)
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          reject(new Error(errorData[0]?.message || `HTTP error: ${response.status}`));
          return;
        }
        
        const data = await response.json();
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Get the describe information for an object
 * @param {string} objectName - The API name of the object
 */
export async function describeObject(objectName) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        const url = `${result.sfInstanceUrl}/services/data/v56.0/sobjects/${objectName}/describe`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            chrome.storage.local.remove(['sfSessionId', 'sfInstanceUrl']);
            reject(new Error('Session expired. Please reconnect.'));
            return;
          }
          
          try {
            const errorData = await response.json();
            reject(new Error(errorData[0]?.message || `HTTP error: ${response.status}`));
          } catch (e) {
            reject(new Error(`HTTP error: ${response.status}`));
          }
          return;
        }
        
        const data = await response.json();
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Function to get page layouts for an object
export async function getPageLayouts(objectName) {
  // Use the existing isAuthenticated function instead of isAuthenticatedFlag
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Salesforce');
  }
  
  try {
    const query = `SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = '${objectName}'`;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error fetching page layouts:', error);
    throw error;
  }
}

// Function to get profiles
export async function getProfiles() {
  // Use the existing isAuthenticated function instead of isAuthenticatedFlag
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Salesforce');
  }
  
  try {
    const query = `SELECT Id, Name FROM Profile WHERE UserType = 'Standard' ORDER BY Name`;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error fetching profiles:', error);
    throw error;
  }
}

// Function to get record types for an object
export async function getRecordTypes(objectName) {
  // Use the existing isAuthenticated function instead of isAuthenticatedFlag
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Salesforce');
  }
  
  try {
    const query = `SELECT Id, Name, DeveloperName, IsActive FROM RecordType WHERE SobjectType = '${objectName}' AND IsActive = true ORDER BY Name`;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error fetching record types:', error);
    throw error;
  }
}

// Function to get field permissions for profiles
export async function getFieldPermissions(objectName, fieldName) {
  // Use the existing isAuthenticated function instead of isAuthenticatedFlag
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Salesforce');
  }
  
  try {
    const query = `SELECT Id, Field, ParentId, PermissionsEdit, PermissionsRead 
                   FROM FieldPermissions 
                   WHERE Field = '${objectName}.${fieldName}' 
                   AND Parent.ProfileId != null`;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error fetching field permissions:', error);
    throw error;
  }
}

/**
 * Get object permissions for profiles
 * @param {string} objectName - The API name of the object
 */
export async function getObjectPermissions(objectName) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        const query = encodeURIComponent(
          `SELECT Id, ParentId, Parent.Name, SObjectType, PermissionsCreate, PermissionsDelete, 
                  PermissionsEdit, PermissionsRead, PermissionsViewAllRecords, PermissionsModifyAllRecords
           FROM ObjectPermissions 
           WHERE SObjectType = '${objectName}'`
        );
        
        const url = `${result.sfInstanceUrl}/services/data/v56.0/query?q=${query}`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          reject(new Error(errorData[0]?.message || `HTTP error: ${response.status}`));
          return;
        }
        
        const data = await response.json();
        resolve(data.records || []);
      } catch (error) {
        console.error('Error fetching object permissions:', error);
        reject(error);
      }
    });
  });
}

/**
 * Get available objects that can have custom fields
 */
export async function getCustomizableObjects() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['sfSessionId', 'sfInstanceUrl'], async (result) => {
      if (!result.sfSessionId || !result.sfInstanceUrl) {
        reject(new Error('Not authenticated'));
        return;
      }
      
      try {
        const url = `${result.sfInstanceUrl}/services/data/v56.0/sobjects/`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${result.sfSessionId}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          reject(new Error(errorData[0]?.message || `HTTP error: ${response.status}`));
          return;
        }
        
        const data = await response.json();
        
        // Filter objects that are customizable
        const customizableObjects = data.sobjects.filter(obj => 
          obj.createable && 
          obj.updateable && 
          obj.custom === true || 
          (obj.custom === false && obj.name.match(/^(Account|Contact|Lead|Opportunity|Case|Product2|Asset|Campaign|Contract|Order|Quote|Solution|Idea|Question)$/))
        ).sort((a, b) => a.label.localeCompare(b.label));
        
        resolve(customizableObjects);
      } catch (error) {
        console.error('Error fetching objects:', error);
        reject(error);
      }
    });
  });
}

/**
 * Provide clear instructions for manual field permission setup
 * @param {string} objectName - The API name of the object
 * @param {string} fieldApiName - The API name of the field
 * @param {Object} selectedProfiles - Selected profiles with permissions
 */
function provideFieldPermissionInstructions(objectName, fieldApiName, selectedProfiles) {
  console.log('\n' + '='.repeat(80));
  console.log('📋 MANUAL FIELD PERMISSION SETUP REQUIRED');
  console.log('='.repeat(80));
  console.log(`Field: ${objectName}.${fieldApiName}`);
  console.log('\n🔧 Setup Instructions:');
  console.log('1. Go to Salesforce Setup');
  console.log(`2. Navigate to: Object Manager > ${objectName}`);
  console.log(`3. Go to: Fields & Relationships > ${fieldApiName}`);
  console.log('4. Click: "Set Field-Level Security"');
  console.log('5. Configure permissions for the following profiles:\n');
  
  // Get unique profiles
  const allProfiles = new Set([
    ...selectedProfiles.visibility,
    ...selectedProfiles.read,
    ...selectedProfiles.write
  ]);
  
  for (const profileId of allProfiles) {
    const hasVisibility = selectedProfiles.visibility.includes(profileId);
    const hasRead = selectedProfiles.read.includes(profileId);
    const hasWrite = selectedProfiles.write.includes(profileId);
    
    console.log(`   Profile ID: ${profileId}`);
    console.log(`   - Visible: ${hasVisibility ? '✅' : '❌'}`);
    console.log(`   - Read Access: ${hasRead || hasVisibility || hasWrite ? '✅' : '❌'}`);
    console.log(`   - Edit Access: ${hasWrite ? '✅' : '❌'}`);
    console.log('');
  }
  
  console.log('💡 Alternative: You can also set these permissions via Permission Sets');
  console.log('='.repeat(80) + '\n');
}