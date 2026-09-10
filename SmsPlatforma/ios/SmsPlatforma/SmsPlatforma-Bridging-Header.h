//
//  SmsPlatforma-Bridging-Header.h
//  SmsPlatforma
//
//  Bridging header for Swift ↔ Objective-C interop.
//  Imports zlib for XLSX (ZIP) decompression in ExcelContactsModule.
//

#import <zlib.h>

/// Wrapper around inflateInit2 C macro
static inline int sms_inflateInit2(z_streamp strm, int windowBits) {
    return inflateInit2(strm, windowBits);
}

/// Wrapper around inflate to prevent Swift name collision
static inline int sms_zlib_inflate(z_streamp strm, int flush) {
    return inflate(strm, flush);
}

/// Wrapper around inflateEnd
static inline int sms_zlib_inflateEnd(z_streamp strm) {
    return inflateEnd(strm);
}
