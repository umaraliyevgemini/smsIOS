package com.smsplatforma

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SmsToolsPackage : BaseReactPackage() {
  override fun getModule(
      name: String,
      reactContext: ReactApplicationContext,
  ): NativeModule? =
      when (name) {
        ExcelContactsModule.NAME -> ExcelContactsModule(reactContext)
        SmsSenderModule.NAME -> SmsSenderModule(reactContext)
        else -> null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        ExcelContactsModule.NAME to
            ReactModuleInfo(
                ExcelContactsModule.NAME,
                ExcelContactsModule::class.java.name,
                false,
                false,
                false,
                false,
            ),
        SmsSenderModule.NAME to
            ReactModuleInfo(
                SmsSenderModule.NAME,
                SmsSenderModule::class.java.name,
                false,
                false,
                false,
                false,
            ),
    )
  }
}
