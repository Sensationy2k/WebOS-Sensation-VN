# WebOS Sensation VN

Màn hình chính kiểu Apple TV cho TV LG chạy webOS, có hình nền Bing, gửi ảnh từ điện thoại, trình
bảo vệ màn hình riêng và nút Home luôn về launcher. Phát triển tiếp từ
[webos-vibehack](https://github.com/OmkarK97/webos-vibehack) của OmkarK97, vốn là bản webOS của
[tv-vibehack](https://github.com/Gathin23/tv-vibehack) (Android TV) của Gathin.

![Launcher với hình nền Bing](docs/launcher.jpg)

Đã thử trên LG 65UQ7550PSF (webOS 7.6, firmware 04.60.91), đã root bằng Homebrew Channel.
Bản gốc tiếng Anh, kèm cách cài bằng Developer Mode, ở [README.en.md](README.en.md).

## Tính năng

- **Launcher kiểu Apple TV**: hàng dock 4 app, lưới app bên dưới, ánh màu theo app đang chọn.
  Icon lấy bản 192 px trên TV (nét hơn bản 130 px LG cho phép tải), màu nền ô tính sẵn trên máy tính.
- **Hình nền**: ảnh Bing tự đổi mỗi ngày, hoặc chọn một trong ~15 ảnh Bing gần nhất, hoặc ảnh của bạn.
- **Gửi ảnh từ điện thoại**: quét mã QR trên TV, chọn ảnh trong máy (Android có cả Google Photos)
  hoặc dán link chia sẻ Google Photos / link ảnh bất kỳ. Ảnh hiện lên TV ngay.
- **Giữ OK trên một ô app** (hoặc phím Info / phím đỏ): Di chuyển, Ẩn, Gỡ cài đặt, Hiện lại app đã ẩn.
- **Nút Home luôn về launcher**. Màn hình LG vẫn mở được bằng nút ngôi nhà trên thanh trên cùng.
  Bật TV vào Live TV hay HDMI không tín hiệu cũng tự về launcher.
- **Trình bảo vệ màn hình riêng**: trình chiếu ảnh Bing và ảnh gửi từ điện thoại, có đồng hồ tiếng
  Việt, ảnh và đồng hồ di chuyển chậm để tránh lưu ảnh trên màn OLED. Thay luôn phần quảng cáo của LG.
- **Nhẹ hơn**: tuỳ chọn không cho Google Assistant nằm sẵn trong RAM (khoảng 40 MB).

| Chọn hình nền | Trình bảo vệ màn hình |
|---|---|
| ![Bảng chọn hình nền](docs/wallpaper-picker.jpg) | ![Trình bảo vệ màn hình](docs/screensaver.jpg) |

## Cần có

- TV LG webOS **đã root bằng [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)**,
  bật **SSH** trong phần cài đặt của Homebrew Channel. Nút Home, screensaver, gỡ app và bỏ Google
  Assistant chỉ làm được khi có root. TV chưa root vẫn dùng được launcher và hình nền qua Developer
  Mode, xem [README.en.md](README.en.md).
- Máy tính cùng mạng Wi-Fi với TV, có:
  - [Node.js](https://nodejs.org) (công cụ `ares` của LG được tải tự động qua `npx`)
  - [Python 3](https://www.python.org)
  - Git. Trên Windows, chạy các lệnh dưới đây trong **Git Bash**.

## Cài đặt

**1. Tạo khoá SSH và cho TV tin khoá đó** (một lần). `192.168.1.50` là IP của TV, xem trong
Cài đặt → Mạng của TV. Lệnh thứ hai hỏi mật khẩu root của TV (mặc định của Homebrew Channel là
`alpine`).

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/tvkey
cat ~/.ssh/tvkey.pub | ssh root@192.168.1.50 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**2. Tải mã nguồn và thư viện Python**

```bash
git clone https://github.com/Sensationy2k/WebOS-Sensation-VN.git
cd WebOS-Sensation-VN
python -m venv venv
venv/Scripts/pip install websockets pillow      # macOS / Linux: venv/bin/pip
```

**3. Cài lên TV**

```bash
TV_HOST=192.168.1.50 TV_SSH_KEY=~/.ssh/tvkey HOME_WATCH=1 SCREENSAVER=1 NO_ASSISTANT=1 ./install-root.sh
```

Lần chạy đầu, TV hỏi **"Cho phép thiết bị này?"**: bấm đồng ý. Script đọc danh sách app và icon
từ TV, đóng gói, cài launcher kèm dịch vụ, rồi mở launcher.

Các tuỳ chọn (bỏ đi cái nào không muốn):

| Tuỳ chọn | Làm gì |
|---|---|
| `HOME_WATCH=1` | Nút Home luôn về launcher, chạy ngay trên TV và tự bật cùng TV |
| `SCREENSAVER=1` | Thay trình bảo vệ màn hình của LG bằng trình chiếu ảnh Bing và ảnh của bạn |
| `NO_ASSISTANT=1` | Không cho Google Assistant nằm sẵn trong RAM |

**Cài hoặc gỡ app trên TV xong**, chạy lại lệnh ở bước 3 để launcher cập nhật danh sách
(webOS không cho app tự đọc danh sách app đã cài). App gỡ từ menu của launcher thì biến mất ngay.

**Phím tắt**: khi đang mở launcher, giữ một phím số trên remote (ví dụ **1**) để gán. Từ đó giữ
phím 1 ở đâu cũng mở launcher.

## Sử dụng

- **Mũi tên / OK**: chọn và mở app. Bấm lên từ hàng dock để tới các nút trên cùng.
- **Nút trên cùng**: Inputs (HDMI, Live TV), Wi-Fi, **Hình nền**, **Màn hình LG** (ngôi nhà), Settings.
- **Giữ OK trên một ô** (hoặc phím Info / phím đỏ) để mở menu:
  - **Di chuyển**: mũi tên để dời ô (lên hàng đầu là vào dock), OK để đặt, Back để huỷ.
  - **Ẩn**: giấu icon, app vẫn còn. **Hiện lại app đã ẩn** có trong cùng menu.
  - **Gỡ cài đặt**: có hỏi xác nhận, chọn sẵn Huỷ. Không có với app hệ thống của LG và Homebrew Channel.
- **Hình nền**: mở nút hình ảnh. Chọn Mặc định, Bing mỗi ngày, một ảnh Bing, hoặc quét mã QR bằng
  điện thoại cùng Wi-Fi để gửi ảnh. Trang gửi ảnh chỉ mở khi bảng Hình nền đang mở trên TV. Ảnh gửi
  lên cũng được thêm vào trình bảo vệ màn hình (giữ 60 ảnh mới nhất).
- **Màn hình LG** (cho các menu của LG): nút ngôi nhà. Ở đó bấm Home không bị kéo về launcher; mở
  app khác xong, Home lại về launcher như thường.
- Thử trình bảo vệ màn hình ngay:
  `ssh -i ~/.ssh/tvkey root@192.168.1.50 "luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreenSaver '{}'"`

## Gỡ bỏ

Mọi thay đổi trên TV đều đảo ngược được, file hệ thống của LG không bị sửa. Trên TV (qua SSH):

| Muốn bỏ | Lệnh |
|---|---|
| Nút Home về như cũ | `rm /var/lib/webosbrew/init.d/tvhome-homewatch; pkill -f tvhome-homewatch` |
| Screensaver của LG | `rm /var/lib/webosbrew/init.d/tvhome-screensaver` rồi khởi động lại TV |
| Google Assistant như cũ | `rm /var/lib/webosbrew/init.d/tvhome-noassistant` rồi khởi động lại TV |
| Cả launcher | gỡ app "Home" như mọi app khác, hoặc `luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{"id":"com.gathin.tvhome"}'` |

Ảnh gửi từ điện thoại nằm ở `/media/internal/tvhome-photos`.

## Xử lý sự cố

- **Không hiện hộp thoại ghép nối trên TV**: bật tuỳ chọn kết nối từ ứng dụng di động
  (Cài đặt → Chung → Thiết bị → "LG Connect Apps" hoặc tương tự).
- **Nút Home không về launcher**: xem `/tmp/tvhome-homewatch.log` trên TV.
- **Gỡ app báo "chưa có quyền root"**: chạy lại `install-root.sh`. Mỗi lần cài, dịch vụ của launcher
  phải được Homebrew Channel nâng quyền lại (`elevate-service`), script tự làm việc này.
- **Tự viết lệnh `luna-send` qua SSH không ra gì**: trên firmware này `luna-send` cần một terminal.
  Dùng `ssh -t`, hoặc chạy trong `script -q -c "..." /dev/null`.

## Các file

| File | Làm gì |
|---|---|
| [`app/`](app/) | Launcher: `index.html`, `style.css`, `app.js`, `config.js`, `appinfo.json` |
| [`service/`](service/) | Dịch vụ Node trên TV: trang gửi ảnh, ảnh Bing, gỡ app |
| [`screensaver/main.qml`](screensaver/main.qml) | Trình bảo vệ màn hình |
| [`install-root.sh`](install-root.sh) | Cài mọi thứ lên TV đã root qua SSH |
| [`sync-apps.py`](sync-apps.py) | Đọc app, icon và đầu vào HDMI từ TV vào `app/apps.js` |
| [`home-watch-tv.sh`](home-watch-tv.sh) | Nút Home về launcher, chạy trên TV |
| [`screensaver-tv.sh`](screensaver-tv.sh) | Gắn trình bảo vệ màn hình mới mỗi lần khởi động |
| [`no-assistant-tv.sh`](no-assistant-tv.sh) | Không cho Google Assistant nằm sẵn trong RAM |
| [`install.sh`](install.sh), [`home-watch.py`](home-watch.py) | Cách gốc cho TV chưa root (Developer Mode), xem README.en.md |
| [`lgtv.py`](lgtv.py) | Kết nối dịch vụ điều khiển từ xa của TV |

## Ghi công

Thiết kế, bố cục và icon từ [tv-vibehack](https://github.com/Gathin23/tv-vibehack) của
[Gathin](https://github.com/Gathin23); bản webOS gốc
[webos-vibehack](https://github.com/OmkarK97/webos-vibehack) của OmkarK97. Font Outfit theo
SIL Open Font License ([`app/fonts/OFL.txt`](app/fonts/OFL.txt)). Thư viện QR
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) của Kazuhiko Arase (MIT).
Giấy phép MIT, xem [`LICENSE`](LICENSE).
