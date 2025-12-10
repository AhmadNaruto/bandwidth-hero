# Bandwidth Hero Data Compression Service - Project Context

## Project Overview
This is a **serverless image compression service** designed to work with the Bandwidth Hero browser extension. The service acts as a proxy that compresses images on-the-fly, converting them to lower-resolution WebP or JPEG formats to save bandwidth and improve browsing experience.

### Key Features:
- Serverless architecture hosted on Netlify Functions
- On-the-fly image compression using Sharp library
- Support for both WebP and JPEG output formats
- Optional grayscale conversion
- Quality adjustment capability
- Forwarding of browser headers to avoid detection by services like Cloudflare

### Architecture:
- Main entry point: `functions/index.js` (Netlify Function)
- Utilities in `util/` directory for compression, header picking, and compression decision logic
- Client-side integration with Bandwidth Hero browser extension

## Technologies Used
- Node.js runtime
- Sharp library for image processing
- Netlify Functions for serverless deployment
- node-fetch for HTTP requests
- Jest for testing

## Dependencies
As defined in `package.json`:
- sharp: ^0.33.5 (image processing)
- node-fetch: ^2.7.0 (HTTP client)
- jest: ^30.0.4 (testing framework)

## Main Components

### Functions
- `functions/index.js`: Main serverless function that handles image compression requests

### Utilities (`util/`)
- `compress.js`: Image compression logic using Sharp
- `shouldCompress.js`: Decision logic for whether to compress an image
- `pick.js`: Utility to extract specific headers from HTTP requests

## URL Parameters
The service accepts the following query parameters:
- `url`: Target image URL to compress (required)
- `jpeg`: Use JPEG format (optional, defaults to WebP)
- `bw`: Enable grayscale conversion (optional)
- `l`: Quality level (optional, defaults to 40)

## Building and Running

### Development Setup
```bash
# Install dependencies
npm install

# Run tests
npm test

# Local development (requires Netlify CLI)
npm install -g netlify-cli
ntl dev
```

### Testing
Run unit tests with Jest:
```bash
npm test
```

### Deployment
- Deploy to Netlify using the provided deployment button in README
- The function endpoint becomes: `https://your-netlify-domain.netlify.app/api/index`
- Configure the Bandwidth Hero browser extension to use this endpoint

## Development Conventions

### Code Structure
- Keep functions lightweight and focused
- Separate concerns into utility modules
- Handle errors gracefully with appropriate HTTP status codes
- Maintain compatibility with Bandwidth Hero browser extension API

### Image Processing Logic
- Images below minimum size thresholds are not compressed
- PNG and GIF files have higher minimum size requirements
- Quality level affects compression ratio
- Browser headers are forwarded to maintain authenticity of requests

## File Structure
```
bandwidth-hero/
├── functions/
│   └── index.js          # Main serverless function
├── util/
│   ├── compress.js       # Image compression utilities
│   ├── shouldCompress.js # Compression eligibility logic
│   └── pick.js          # Header extraction utilities
├── tests/
│   └── index.test.js    # Unit tests
├── package.json         # Dependencies and scripts
├── netlify.toml         # Netlify configuration
├── README.md           # Project documentation
└── index.html          # Landing page
```

## Special Notes
- The service forwards user headers to avoid being blocked by services like Cloudflare
- Original images are downloaded and processed without being saved to disk
- The service works as a proxy, passing user's IP address through to the origin host
- Base64 encoding is used for binary image data transmission