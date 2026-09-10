//
//  ExcelContactsBridge.m
//  SmsPlatforma
//
//  Objective-C bridge that registers the Swift ExcelContacts native module
//  with React Native's bridge via RCT_EXTERN_MODULE / RCT_EXTERN_METHOD.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ExcelContacts, NSObject)

RCT_EXTERN_METHOD(pickAndParse:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
