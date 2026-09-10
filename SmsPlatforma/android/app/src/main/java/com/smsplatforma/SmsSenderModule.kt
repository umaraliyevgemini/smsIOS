package com.smsplatforma

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = SmsSenderModule.NAME)
class SmsSenderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun sendSms(phoneNumber: String, message: String, promise: Promise) {
    val normalizedPhone = normalizePhone(phoneNumber)

    if (normalizedPhone.isBlank()) {
      promise.reject("SMS_PHONE_EMPTY", "Telefon raqam bo'sh.")
      return
    }

    if (message.isBlank()) {
      promise.reject("SMS_MESSAGE_EMPTY", "SMS matni bo'sh.")
      return
    }

    if (
        reactContext.checkSelfPermission(Manifest.permission.SEND_SMS) !=
            PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("SMS_PERMISSION_MISSING", "SEND_SMS ruxsati berilmagan.")
      return
    }

    try {
      val smsManager = getSmsManager()
      val messageParts = smsManager.divideMessage(message)

      if (messageParts.size > 1) {
        smsManager.sendMultipartTextMessage(normalizedPhone, null, messageParts, null, null)
      } else {
        smsManager.sendTextMessage(normalizedPhone, null, message, null, null)
      }

      val result = Arguments.createMap()
      result.putString("phone", normalizedPhone)
      result.putInt("parts", maxOf(messageParts.size, 1))
      promise.resolve(result)
    } catch (error: SecurityException) {
      promise.reject("SMS_SECURITY_ERROR", "SMS yuborish ruxsati rad etildi.", error)
    } catch (error: Exception) {
      promise.reject("SMS_SEND_FAILED", error.message ?: "SMS yuborilmadi.", error)
    }
  }

  private fun getSmsManager(): SmsManager {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      reactContext.getSystemService(SmsManager::class.java)
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }
  }

  private fun normalizePhone(phoneNumber: String): String {
    val trimmed = phoneNumber.trim().replace(Regex("[\\s()\\-]"), "")
    if (trimmed.isBlank()) return ""
    val hasPlus = trimmed.startsWith("+")
    var digits = trimmed.replace(Regex("\\D"), "")
    if (digits.isBlank()) return ""
    if (digits.startsWith("00998")) {
      digits = digits.substring(2)
    }
    if (digits.startsWith("998") && digits.length == 12) {
      return "+$digits"
    }
    if (digits.length == 9) {
      return "+998$digits"
    }
    if (digits.length == 10 && (digits.startsWith("8") || digits.startsWith("0"))) {
      return "+998${digits.substring(1)}"
    }
    if (hasPlus) return "+$digits"
    if (digits.startsWith("998")) return "+$digits"
    return if (digits.length >= 7) "+998$digits" else digits
  }

  companion object {
    const val NAME = "SmsSender"
  }
}
