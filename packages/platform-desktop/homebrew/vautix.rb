cask "vautix" do
  version "0.8.0"
  sha256 "4a8763fe109d7ef3fc7b4253afe3b88484f53a9554333ebbed1e70cb5b39795b"

  url "https://github.com/flythenimbus/vautix/releases/download/#{version}-desktop/Vautix_#{version}_universal.dmg"
  name "Vautix"
  desc "Password manager"
  homepage "https://vautix.sh/"

  livecheck do
    url :url
    regex(/^v?(\d+(?:\.\d+)+)-desktop$/i)
  end

  auto_updates true
  depends_on :macos

  app "Vautix.app"

  uninstall launchctl: "Vautix",
            quit:      "app.vautix.desktop"

  zap trash: [
    "~/Library/Application Support/*/*/NativeMessagingHosts/app.vautix.desktop.json",
    "~/Library/Application Support/*/NativeMessagingHosts/app.vautix.desktop.json",
    "~/Library/Application Support/app.vautix.desktop",
    "~/Library/Caches/app.vautix.desktop",
    "~/Library/HTTPStorages/app.vautix.desktop",
    "~/Library/Logs/app.vautix.desktop",
    "~/Library/Preferences/app.vautix.desktop.plist",
    "~/Library/Saved Application State/app.vautix.desktop.savedState",
    "~/Library/WebKit/app.vautix.desktop",
  ]
end
