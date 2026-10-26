{
  "targets": [
    {
      "target_name": "native_bridge",
      "sources": ["native-bridge.cc"],
      "defines": ["NAPI_VERSION=8"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++17"]
        }
      }
    }
  ]
}
