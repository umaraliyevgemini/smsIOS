package com.smsplatforma

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

@ReactModule(name = ExcelContactsModule.NAME)
class ExcelContactsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var pendingPickPromise: Promise? = null

  private val activityEventListener =
      object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
          if (requestCode != PICK_FILE_REQUEST_CODE) {
            return
          }

          val promise = pendingPickPromise ?: return
          pendingPickPromise = null

          if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.reject("EXCEL_PICK_CANCELLED", "Fayl tanlanmadi.")
            return
          }

          val uri = data.data ?: return
          Thread {
                try {
                  val copiedFile = copyToCache(uri)
                  val parsedJson = parseWithPython(copiedFile)
                  promise.resolve(parsedJson)
                } catch (error: Exception) {
                  promise.reject(
                      "EXCEL_PARSE_FAILED",
                      error.message ?: "Excel fayl o'qilmadi.",
                      error,
                  )
                }
              }
              .start()
        }
      }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun pickAndParse(promise: Promise) {
    val activity = reactContext.getCurrentActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Ilova oynasi tayyor emas.")
      return
    }

    if (pendingPickPromise != null) {
      promise.reject("PICKER_BUSY", "Oldingi fayl tanlash jarayoni hali tugamagan.")
      return
    }

    pendingPickPromise = promise

    val intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          putExtra(
              Intent.EXTRA_MIME_TYPES,
              arrayOf(
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  "text/csv",
                  "application/csv",
              ),
          )
        }

    try {
      activity.startActivityForResult(intent, PICK_FILE_REQUEST_CODE)
    } catch (error: Exception) {
      pendingPickPromise = null
      promise.reject("EXCEL_PICK_FAILED", error.message ?: "Fayl tanlash ochilmadi.", error)
    }
  }

  private fun copyToCache(uri: Uri): File {
    val displayName = resolveDisplayName(uri)
    val extension =
        when {
          displayName?.lowercase(Locale.US)?.endsWith(".csv") == true -> ".csv"
          else -> ".xlsx"
        }
    val targetFile =
        File(reactContext.cacheDir, "contacts_import_${System.currentTimeMillis()}$extension")

    val inputStream =
        reactContext.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("Fayl oqimi ochilmadi.")

    inputStream.use { input ->
      FileOutputStream(targetFile).use { output -> input.copyTo(output) }
    }

    return targetFile
  }

  private fun resolveDisplayName(uri: Uri): String? {
    reactContext.contentResolver
        .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0) {
              return cursor.getString(index)
            }
          }
        }
    return null
  }

  private fun parseWithPython(file: File): String {
    if (!Python.isStarted()) {
      Python.start(AndroidPlatform(reactContext))
    }

    return Python.getInstance()
        .getModule("excel_parser")
        .callAttr("parse_contacts", file.absolutePath)
        .toString()
  }

  companion object {
    const val NAME = "ExcelContacts"
    private const val PICK_FILE_REQUEST_CODE = 4207
  }
}
