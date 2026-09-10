//
//  SmsSenderModule.swift
//  SmsPlatforma
//
//  iOS native module that sends SMS using MFMessageComposeViewController.
//  Unlike Android, iOS requires the user to manually confirm each SMS
//  by tapping the "Send" button in the system compose sheet.
//

import Foundation
import UIKit
import MessageUI

@objc(SmsSender)
class SmsSenderModule: NSObject {

    private var pendingResolve: ((Any?) -> Void)?
    private var pendingReject: ((String?, String?, Error?) -> Void)?
    private var currentPhone = ""

    @objc static func requiresMainQueueSetup() -> Bool { true }

    // MARK: - React Native Method

    /// Opens the iOS Messages compose sheet pre-filled with the recipient and body.
    /// The promise resolves when the user taps Send, or rejects if cancelled/failed.
    @objc func sendSms(
        _ phoneNumber: String,
        message: String,
        resolve: @escaping (Any?) -> Void,
        rejecter reject: @escaping (String?, String?, Error?) -> Void
    ) {
        let normalized = Self.normalizePhone(phoneNumber)

        guard !normalized.isEmpty else {
            reject("SMS_PHONE_EMPTY", "Telefon raqam bo'sh.", nil)
            return
        }
        guard !message.trimmingCharacters(in: .whitespaces).isEmpty else {
            reject("SMS_MESSAGE_EMPTY", "SMS matni bo'sh.", nil)
            return
        }
        guard MFMessageComposeViewController.canSendText() else {
            reject("SMS_NOT_AVAILABLE",
                   "Bu qurilmada SMS yuborish mumkin emas. SIM karta borligini tekshiring.",
                   nil)
            return
        }

        pendingResolve = resolve
        pendingReject  = reject
        currentPhone   = normalized

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let composeVC = MFMessageComposeViewController()
            composeVC.recipients = [normalized]
            composeVC.body = message
            composeVC.messageComposeDelegate = self

            guard let topVC = Self.topViewController() else {
                self.pendingReject?("NO_VIEW_CONTROLLER", "Ilova oynasi topilmadi.", nil)
                self.cleanup()
                return
            }
            topVC.present(composeVC, animated: true)
        }
    }

    // MARK: - Helpers

    private func cleanup() {
        pendingResolve = nil
        pendingReject  = nil
    }

    private static func topViewController() -> UIViewController? {
        guard let window = UIApplication.shared.delegate?.window,
              let rootVC = window?.rootViewController else { return nil }
        var top = rootVC
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    // MARK: - Phone Normalization (matches Android SmsSenderModule logic)

    static func normalizePhone(_ raw: String) -> String {
        let trimmed = raw
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "[\\s()\\-]", with: "", options: .regularExpression)
        guard !trimmed.isEmpty else { return "" }

        let hasPlus = trimmed.hasPrefix("+")
        var digits = trimmed.replacingOccurrences(of: "\\D", with: "", options: .regularExpression)
        guard !digits.isEmpty else { return "" }

        if digits.hasPrefix("00998") {
            digits = String(digits.dropFirst(2))
        }
        if digits.hasPrefix("998") && digits.count == 12 {
            return "+\(digits)"
        }
        if digits.count == 9 {
            return "+998\(digits)"
        }
        if digits.count == 10 && (digits.hasPrefix("8") || digits.hasPrefix("0")) {
            return "+998\(String(digits.dropFirst()))"
        }
        if hasPlus { return "+\(digits)" }
        if digits.hasPrefix("998") { return "+\(digits)" }
        return digits.count >= 7 ? "+998\(digits)" : digits
    }
}

// MARK: - MFMessageComposeViewControllerDelegate

extension SmsSenderModule: MFMessageComposeViewControllerDelegate {

    func messageComposeViewController(
        _ controller: MFMessageComposeViewController,
        didFinishWith result: MessageComposeResult
    ) {
        let resolve = pendingResolve
        let reject  = pendingReject
        let phone   = currentPhone
        cleanup()

        controller.dismiss(animated: true) {
            switch result {
            case .sent:
                resolve?(["phone": phone, "parts": 1])
            case .cancelled:
                reject?("SMS_CANCELLED", "SMS yuborish bekor qilindi.", nil)
            case .failed:
                reject?("SMS_FAILED", "SMS yuborilmadi.", nil)
            @unknown default:
                reject?("SMS_UNKNOWN", "Noma'lum xato.", nil)
            }
        }
    }
}
