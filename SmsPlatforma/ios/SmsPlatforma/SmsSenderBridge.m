//
//  SmsSenderBridge.m
//  SmsPlatforma
//
//  Objective-C bridge that registers the Swift SmsSender native module
//  with React Native's bridge via RCT_EXTERN_MODULE / RCT_EXTERN_METHOD.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SmsSender, NSObject)

RCT_EXTERN_METHOD(sendSms:(NSString *)phoneNumber
                  message:(NSString *)message
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
