// ==========================================
// 1. DOM 요소 가져오기
// ==========================================
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const resultPage = document.getElementById("result-page");

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const scannedImage = document.getElementById("scannedImage");
const guideBox = document.querySelector(".camera-guide-box");

const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const retakeBtn = document.getElementById("retakeBtn");
const saveBtn = document.getElementById("saveBtn");

let stream = null;

// ==========================================
// 2. 카메라 제어 함수
// ==========================================
async function startCamera() {
  console.log("✅ startCamera 함수가 정상적으로 호출되었습니다!");

  if (!window.isOpenCvReady) {
    alert("이미지 처리 엔진을 불러오는 중입니다. 잠시만 기다려주세요.");
    return;
  }

  try {
    landingPage.style.display = "none";
    resultPage.style.display = "none";
    cameraPage.style.display = "flex";

    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.setAttribute("playsinline", true);
    video.play();
    console.log("📸 카메라 스트림 연결 완료");
  } catch (err) {
    console.error("🚨 카메라 오류:", err);
    alert("카메라 권한을 허용해주세요.");
    closeCamera();
  }
}

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;

  cameraPage.style.display = "none";
  landingPage.style.display = "block";
}

// ==========================================
// 3. 촬영 및 스캔 변환 함수 (OpenCV)
// ==========================================
function takePhoto() {
  if (!stream) return;

  try {
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;

    if (vWidth === 0 || vHeight === 0) return;

    canvas.width = vWidth;
    canvas.height = vHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, vWidth, vHeight);

    let src = cv.imread(canvas);
    let dst = new cv.Mat();
    let dsize = new cv.Size(1728, 2200);

    const rect = getCropCoordinates(video, guideBox);

    let x = Math.max(0, Math.floor(rect.x));
    let y = Math.max(0, Math.floor(rect.y));
    let w = Math.min(vWidth - x, Math.floor(rect.w));
    let h = Math.min(vHeight - y, Math.floor(rect.h));

    let roi = src.roi(new cv.Rect(x, y, w, h));

    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      dsize.width,
      0,
      dsize.width,
      dsize.height,
      0,
      dsize.height,
    ]);
    let M = cv.getPerspectiveTransform(srcTri, dstTri);

    cv.warpPerspective(
      roi,
      dst,
      M,
      dsize,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );
    cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21,
      15
    );

    cv.imshow(canvas, dst);
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    src.delete();
    dst.delete();
    roi.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    cameraPage.style.display = "none";
    resultPage.style.display = "flex";
  } catch (err) {
    console.error("🚨 이미지 처리 오류:", err);
    alert("이미지 처리 중 오류가 발생했습니다.");
  }
}

// ==========================================
// 4. 좌표 역계산 헬퍼 함수
// ==========================================
function getCropCoordinates(videoElem, guideBoxElem) {
  const videoRatio = videoElem.videoWidth / videoElem.videoHeight;
  const screenRatio = videoElem.clientWidth / videoElem.clientHeight;
  const guideRect = guideBoxElem.getBoundingClientRect();
  const videoRect = videoElem.getBoundingClientRect();

  let scale,
    offsetX = 0,
    offsetY = 0;

  if (screenRatio > videoRatio) {
    scale = videoElem.videoWidth / videoElem.clientWidth;
    offsetY = (videoElem.videoHeight - videoElem.clientHeight * scale) / 2;
  } else {
    scale = videoElem.videoHeight / videoElem.clientHeight;
    offsetX = (videoElem.videoWidth - videoElem.clientWidth * scale) / 2;
  }

  let realX = (guideRect.left - videoRect.left) * scale + offsetX;
  let realY = (guideRect.top - videoRect.top) * scale + offsetY;
  let realW = guideRect.width * scale;
  let realH = guideRect.height * scale;

  return { x: realX, y: realY, w: realW, h: realH };
}

// ==========================================
// 5. 결과 화면 동작 함수 (다시찍기, 저장)
// ==========================================
function retakePhoto() {
  resultPage.style.display = "none";
  startCamera();
}

function saveImage() {
  try {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const tiffUint8Array = UTIF.encodeImage(
      imageData.data,
      canvas.width,
      canvas.height
    );
    const blob = new Blob([tiffUint8Array], { type: "image/tiff" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14);
    link.download = `scan_${timestamp}.tif`;
    link.href = url;

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    alert("다운로드가 완료되었습니다.");
  } catch (err) {
    console.error("🚨 TIF 변환/저장 오류:", err);
    alert("파일 다운로드에 실패했습니다.");
  }
}

// ==========================================
// 6. 이벤트 리스너 등록
// ==========================================
console.log("🚀 app.js 파일 로드 완료! 이벤트 리스너를 등록합니다.");

if (startCaptureBtn) {
  startCaptureBtn.addEventListener("click", startCamera);
  console.log("✅ 사진촬영 버튼 연결 성공");
} else {
  console.error(
    "❌ 사진촬영 버튼(startCaptureBtn)을 HTML에서 찾을 수 없습니다!"
  );
}

if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
if (shutterBtn) shutterBtn.addEventListener("click", takePhoto);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
