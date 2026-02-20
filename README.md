# Salesforce Record Insert Chrome Extension

A Chrome extension that provides an intuitive interface for bulk record creation in Salesforce, featuring a collapsible entry system similar to the UI shown in your requirements.

## Features

- **Object Selection**: Choose from Lead, Contact, Account, Opportunity, and Case objects
- **Multiple Entry Creation**: Create multiple records with collapsible entries
- **Form Validation**: Built-in validation for required fields and data types
- **Bulk Operations**: Submit all records at once or individually
- **Automatic Authentication**: Detects existing Salesforce sessions automatically
- **Session Persistence**: Monitors and updates session information in real-time
- **Responsive Design**: Works on various screen sizes
- **Status Tracking**: Visual indicators for draft, submitted, and error states

## Installation

1. **Download/Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right
4. **Click "Load unpacked"** and select the extension folder
5. **Pin the extension** to your Chrome toolbar for easy access

## Setup for OAuth (Optional)

If you want to use OAuth authentication instead of session detection:

1. Create a Connected App in your Salesforce org:
   - Setup → App Manager → New Connected App
   - Enable OAuth Settings
   - Add these scopes: `api`, `web`, `refresh_token`
   - Set callback URL to: `chrome-extension://[extension-id]/oauth/callback`

2. Update the `CLIENT_ID` in `background.js` with your Connected App's Consumer Key

## Usage

### Using the Extension
1. Navigate to any Salesforce page in Chrome
2. The extension will automatically detect and store your Salesforce session
3. Click the floating lightning bolt button in the bottom-right corner
4. This opens the Record Insert tool in a new tab with automatic authentication

### Alternative Access
1. Click the extension icon in Chrome toolbar (if pinned)
2. This directly opens the Record Insert tool

### Creating Records
1. **Select Object Type** from the dropdown (Lead, Contact, Account, etc.)
2. **Click "Add New Entry"** to create a new record form
3. **Fill in the fields** - required fields are marked with an asterisk (*)
4. **Submit Options**:
   - Submit individual records using the "Submit" button on each entry
   - Submit all records at once using "Submit All Records"
5. **Manage Entries**:
   - Collapse/expand entries using the arrow button
   - Delete entries using the trash button
   - Reset entries to clear all data

## File Structure

```
├── manifest.json          # Extension configuration
├── background.js          # Service worker for session management
├── content.js            # Content script for automatic session capture
├── pages/
│   ├── tab.html          # Main application interface
│   ├── tab.css           # Styling for the application
│   └── tab.js            # Main application logic
├── assets/
│   └── icons/
│       └── lighting.png  # Extension icon
└── salesforce-api.js     # Salesforce API integration
```

## Supported Salesforce Objects

### Lead
- First Name, Last Name*, Company*, Email*, Phone
- Lead Status*, Lead Source, Title, Website, Industry

### Contact
- First Name, Last Name*, Email, Phone, Title
- Department, Mobile Phone, Lead Source

### Account
- Account Name*, Type, Industry, Phone
- Website, Employees, Annual Revenue

### Opportunity
- Opportunity Name*, Stage*, Close Date*, Amount
- Probability, Lead Source, Type

### Case
- Subject*, Status*, Priority, Origin
- Type, Description

*Required fields

## Authentication

The extension uses **automatic session detection** that:

1. **Monitors Salesforce tabs** for active sessions
2. **Captures session cookies** automatically when you visit Salesforce
3. **Stores session information** securely in browser storage
4. **Updates sessions** in real-time as you navigate

No manual authentication is required - just be logged into Salesforce!

## Browser Compatibility

- Chrome 88+
- Manifest V3 compatible

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Ensure you're logged into Salesforce in another tab
   - Try the OAuth authentication method
   - Check browser console for detailed error messages

2. **Records Not Submitting**
   - Verify all required fields are filled
   - Check your Salesforce permissions
   - Ensure you have create access for the selected object

3. **Extension Not Loading**
   - Refresh the extension from chrome://extensions/
   - Check browser console for errors
   - Ensure all files are properly loaded

### Debug Mode

Open browser console and type `SF_EXTENSION_DEBUG` to access debugging functions:
- `SF_EXTENSION_DEBUG.extractSessionInfo()` - Check session detection
- `SF_EXTENSION_DEBUG.getSalesforceEnvironment()` - Check Salesforce environment

## Security & Privacy

- No data is stored outside of your Salesforce org
- Session tokens are stored locally in Chrome storage
- All communication is direct to your Salesforce instance
- No third-party services are used

## Development

To modify or extend the extension:

1. Make your changes to the relevant files
2. Reload the extension in Chrome (chrome://extensions/)
3. Test thoroughly in a Salesforce sandbox environment

## License

This project is provided as-is for educational and development purposes.

## Support

For issues or questions:
1. Check the browser console for error messages
2. Verify Salesforce permissions and field accessibility
3. Test in a Salesforce sandbox environment first
