# Bandwidth Hero Data Compression Service

Welcome to the **Serverless** port of Bandwidth Hero Data Compression Service 🚀. This service is designed to compress images on the fly, saving you bandwidth and improving your browsing experience.

To get started with deploying your own instance of this service, please follow the detailed instructions in the #Deployment section below.

Forked from [adi-g15/bandwidth-hero-proxy](https://github.com/adi-g15/bandwidth-hero-proxy) just trying to make the code up-to-date and error less upto my limited (equal to nothing) coding knowledge.

The original and this fork, both are, data compression service used by [Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) browser extension. It compresses (optionally grayscale) given image to low-res [WebP](https://developers.google.com/speed/webp/) or JPEG image.

It downloads original image and transforms it with [Sharp](https://github.com/lovell/sharp) on the fly without saving images on disk.

**Benefits** - It's faster for initial requests, as it doesn't require restarting a sleeping heroku server deployment, also, you may benefit from a better ping (in my case it is such)

> Note: It downloads images on user's behalf (By passing in same headers to the domain with required image), passing cookies and user's IP address through to the origin host.

## Features

- **On-the-fly Image Compression**: Converts images to WebP or JPEG formats with adjustable quality
- **Modern Logging System**: Structured, clean logging of the compression process with multiple log levels
- **Performance Monitoring**: Time tracking for various operations to identify bottlenecks
- **Cloudflare Compatibility**: Forwards browser headers to avoid detection by Cloudflare and similar services
- **Serverless Architecture**: Deployable on Netlify Functions for cost-effective scaling
- **Format Options**: Support for both WebP and JPEG output formats with quality adjustment capability
- **Grayscale Conversion**: Optional grayscale conversion for images to reduce file size further
- **Quality Control**: Adjustable quality levels (default 40) allowing control over compression ratio
- **Intelligent Compression Logic**: Smart decision-making system that determines whether to compress images based on size, format, and user preferences
- **Header Forwarding**: Passes through user headers (User-Agent, Accept, Accept-Language, Accept-Encoding, Cookie, DNT, Referer) to maintain authenticity of requests
- **IP Address Preservation**: Maintains user's IP address when forwarding requests to origin hosts
- **Bypass Logic**: Automatically bypasses compression for very small images or those that don't meet specific criteria
- **Size Validation**: Includes checks to ensure compressed output isn't larger than original
- **Transparency Handling**: Special handling for transparent images to determine compression appropriateness
- **Dimension Management**: Automatic resizing with maximum width limits to optimize compression
- **Metadata Extraction**: Safe extraction and utilization of image metadata for optimal processing
- **Cache Management**: Proper cache headers to prevent unwanted caching of compressed images
- **Health Checking**: Built-in health check endpoint for monitoring service availability
- **Error Handling**: Comprehensive error handling with appropriate HTTP status codes
- **Content Type Detection**: Accurate identification and validation of image types for appropriate processing
- **Bandwidth Optimization**: Significant reduction in image file sizes to save bandwidth and improve load times

## Logging

The service features a modern structured logging system that creates clean, JSON-formatted logs with:

- Detailed compression metrics (original vs compressed size, format, quality, etc.)
- Request information (URL, user agent, referer, IP)
- Performance timing (fetch time, processing time)
- Error details with stack traces when applicable
- Bypass information for images that don't meet compression criteria

See `docs/logging-system.md` for full documentation on the logging system.

## Cloudflare Compatibility

This proxy forwards browser headers (User-Agent, Accept, Accept-Language, Accept-Encoding, Cookie, DNT, Referer) to make requests appear like legitimate browser requests. This helps avoid being blocked by Cloudflare CAPTCHA challenges that commonly trigger on bot-like requests.

## Deployment

You need to deploy the functions to Netlify:

[![Deploy](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/ukind/bandwidth-hero-proxy2)

Then, in the **Data Compression Service** in Bandwidth Hero extension, add `https://your-netlify-domain.netlify.app/api/index`, and you are good to go.

<!-- READ THIS ARTICLE LATER AdityaG
Check out [this guide](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04)
on how to setup Node.js on Ubuntu.
DigitalOcean also provides an
[easy way](https://www.digitalocean.com/products/one-click-apps/node-js/) to setup a server ready to
host Node.js apps.
-->
