//
//  SmsPlatforma-Bridging-Header.h
//  SmsPlatforma
//
//  Bridging header for Swift ↔ Objective-C interop.
//  Imports zlib for XLSX (ZIP) decompression in ExcelContactsModule.
//

#import <zlib.h>

/// Wrapper around the inflateInit2 C macro so that Swift can call it directly.
/// The macro passes ZLIB_VERSION automatically, which Swift cannot expand.
static inline int sms_inflateInit2(z_streamp strm, int windowBits) {
    return inflateInit2(strm, windowBits);
}
