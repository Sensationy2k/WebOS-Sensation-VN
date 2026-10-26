/*
 * Slideshow screensaver: Bing's pictures of the day and the pictures sent from a phone through the
 * launcher's wallpaper panel (kept in PHOTO_DIR by service/service.js), in random order, with a clock.
 *
 * It replaces LG's screensaver on a rooted TV (screensaver-tv.sh bind-mounts it at boot):
 *   mount --bind main.qml /usr/palm/applications/com.webos.app.screensaver/qml/main.qml
 * Try it:
 *   luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreenSaver '{}'
 *
 * Everything drifts (the pictures zoom slowly, the clock moves with each picture) so nothing stays
 * put long enough to mark an OLED panel.
 */
import QtQuick 2.4
import QtQuick.Window 2.2
import Eos.Window 0.1
import Qt.labs.folderlistmodel 2.1

WebOSWindow {
    id: window

    width: 1920
    height: 1080
    windowType: "_WEBOS_WINDOW_TYPE_SCREENSAVER"
    color: "black"
    title: "Screensaver"
    appId: "com.webos.app.screensaver"
    visible: true

    property string photoDir: "file:///media/internal/tvhome-photos"
    property int slideMs: 20000
    property int fadeMs: 1600
    property var bing: []        // [{url, title}]
    property var queue: []
    property var front: null     // the slide on screen (one of two, crossfading)
    property bool started: false

    FolderListModel {
        id: photos
        folder: window.photoDir
        nameFilters: ["*.jpg", "*.jpeg", "*.png", "*.webp", "*.gif"]
        showDirs: false
        onCountChanged: if (!window.started && count > 0) window.next()
    }

    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    /** A fresh random round of every picture. */
    function refill() {
        var list = [];
        for (var i = 0; i < photos.count; i++)
            list.push({ url: photos.get(i, "fileURL").toString(), title: "" });
        return shuffle(list.concat(bing));
    }

    function next() {
        if (!queue.length) queue = refill();
        if (!queue.length) return;   // nothing yet: Bing or the folder will call again
        started = true;
        var item = queue.shift();
        var a = slides.itemAt(0), b = slides.itemAt(1);
        (front === a ? b : a).load(item);
    }

    /** Bing's last fortnight, straight from Bing: two pages of eight. */
    function loadBing() {
        var got = {}, pending = 2;
        [0, 7].forEach(function (idx) {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== XMLHttpRequest.DONE) return;
                if (xhr.status === 200) {
                    try {
                        JSON.parse(xhr.responseText).images.forEach(function (im) {
                            got[im.urlbase] = { url: "https://www.bing.com" + im.urlbase + "_1920x1080.jpg",
                                                title: im.copyright || "" };
                        });
                    } catch (e) { /* a bad page: the other may still do */ }
                }
                if (--pending) return;
                var list = [];
                for (var k in got) list.push(got[k]);
                window.bing = list;
                if (!window.started) window.next();
            };
            xhr.open("GET", "https://www.bing.com/HPImageArchive.aspx?format=js&n=8&mkt=en-US&idx=" + idx);
            xhr.send();
        });
    }

    Component.onCompleted: loadBing()

    Timer {
        interval: window.slideMs
        running: window.started
        repeat: true
        onTriggered: window.next()
    }

    // Two pictures, so the next one fades in over the last.
    Repeater {
        id: slides
        model: 2
        delegate: slideDelegate
    }

    // Darker at the bottom, behind the clock.
    Rectangle {
        anchors.fill: parent
        z: 5
        gradient: Gradient {
            GradientStop { position: 0.55; color: "#00000000" }
            GradientStop { position: 1.0; color: "#99000000" }
        }
    }

    Column {
        id: clock
        z: 6
        x: 120
        y: 820
        spacing: 6
        Behavior on x { NumberAnimation { duration: window.fadeMs; easing.type: Easing.InOutQuad } }
        Behavior on y { NumberAnimation { duration: window.fadeMs; easing.type: Easing.InOutQuad } }

        Text {
            id: time
            color: "white"
            font.pixelSize: 120
            font.weight: Font.Light
            style: Text.Raised
            styleColor: "#66000000"
        }
        Text {
            id: date
            color: "#e6ffffff"
            font.pixelSize: 34
            style: Text.Raised
            styleColor: "#66000000"
        }
        Text {
            id: caption
            width: 1100
            color: "#b3ffffff"
            font.pixelSize: 24
            elide: Text.ElideRight
            text: window.front ? window.front.title : ""
        }
    }

    function moveClock() {
        // A different spot along the bottom each picture.
        clock.x = 100 + Math.random() * 600;
        clock.y = 760 + Math.random() * 90;
    }

    Timer {
        interval: 10000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            var now = new Date(), vi = Qt.locale("vi_VN");
            time.text = now.toLocaleTimeString(vi, "HH:mm");
            date.text = now.toLocaleDateString(vi, "dddd, d MMMM");
        }
    }

    // ---- one picture, faded in once it has loaded -------------------------------------------

    Component {
        id: slideDelegate

        Item {
            id: slide
            width: window.width
            height: window.height
            opacity: 0
            property string title: ""

            function load(item) {
                title = item.title;
                img.source = "";
                img.source = item.url;
            }

            Image {
                id: img
                anchors.fill: parent
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: false
                sourceSize.width: 1920
                sourceSize.height: 1080
                onStatusChanged: {
                    if (status === Image.Ready) {
                        // Slow zoom towards a random point while it is on screen.
                        zoom.stop();
                        img.scale = 1.0;
                        img.transformOrigin = [Item.TopLeft, Item.TopRight, Item.BottomLeft, Item.BottomRight,
                                               Item.Center][Math.floor(Math.random() * 5)];
                        zoom.start();
                        var old = window.front;
                        window.front = slide;
                        slide.z = 1;
                        if (old) old.z = 0;
                        fadeIn.start();
                        if (old) old.fadeOut();
                        window.moveClock();
                    } else if (status === Image.Error) {
                        window.next();   // gone or offline: skip it
                    }
                }
                NumberAnimation on scale {
                    id: zoom
                    running: false
                    from: 1.0
                    to: 1.08
                    duration: window.slideMs + 2 * window.fadeMs
                }
            }

            NumberAnimation { id: fadeIn; target: slide; property: "opacity"; to: 1; duration: window.fadeMs }
            NumberAnimation { id: fadeOutAnim; target: slide; property: "opacity"; to: 0; duration: window.fadeMs }
            function fadeOut() { fadeOutAnim.start(); }
        }
    }
}
