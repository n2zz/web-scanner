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

// 상태 변수
let stream = null;
let isOpenCvReady = false;

// ==========================================
// 2. OpenCV 초기화 콜백 (HTML에서 호출됨)
// ==========================================
// 전역 변수로 선언하여 HTML의 onload에서 무조건 찾을 수 있게 보장합니다.
window.onOpenCvReady = function () {
  isOpenCvReady = true;
  console.log("OpenCV.js 로드 완료!");
};

// ==========================================
// 3. 카메라 제어 함수
// ==========================================
async function startCamera() {
  if (!isOpenCvReady) {
    alert("이미지 처리 엔진을 불러오는 중입니다. 잠시만 기다려주세요.");
    return;
  }

  try {
    // 화면 전환 (랜딩 숨김, 카메라 켬)
    landingPage.style.display = "none";
    resultPage.style.display = "none";
    cameraPage.style.display = "flex";

    // 고해상도 후면 카메라 요청
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

    // iOS Safari 등에서 비디오 자동 재생 보장
    video.setAttribute("playsinline", true);
    video.play();
  } catch (err) {
    console.error("카메라 오류:", err);
    alert("카메라 권한을 허용해주세요. (또는 HTTPS 환경인지 확인)");
    closeCamera();
  }
}

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;

  // 화면 복귀
  cameraPage.style.display = "none";
  landingPage.style.display = "block";
}

// ==========================================
// 4. 촬영 및 스캔 변환 함수 (OpenCV)
// ==========================================
function takePhoto() {
  if (!stream) return;

  try {
    // 원본 비디오 해상도
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;

    if (vWidth === 0 || vHeight === 0) {
      alert("카메라가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    canvas.width = vWidth;
    canvas.height = vHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, vWidth, vHeight);

    // OpenCV 처리 시작
    let src = cv.imread(canvas);
    let dst = new cv.Mat();

    // 타겟 해상도 (1728 x 2200)
    let dsize = new cv.Size(1728, 2200);

    // 가이드 박스 영역 역계산
    const rect = getCropCoordinates(video, guideBox);

    // 안전한 범위로 클램핑 및 정수화 (OpenCV 에러 방지)
    let x = Math.max(0, Math.floor(rect.x));
    let y = Math.max(0, Math.floor(rect.y));
    let w = Math.min(vWidth - x, Math.floor(rect.w));
    let h = Math.min(vHeight - y, Math.floor(rect.h));

    if (w <= 0 || h <= 0) {
      throw new Error("잘라낼 영역이 유효하지 않습니다.");
    }

    let roi = src.roi(new cv.Rect(x, y, w, h));

    // 투영 변환 (Perspective Transform)
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

    // 흑백 및 이진화 (팩스 효과)
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

    // 결과를 캔버스에 그리기 (크기는 1728x2200이 됨)
    cv.imshow(canvas, dst);

    // 화면 미리보기용 이미지 생성 (화면엔 JPEG로 띄움)
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    // 메모리 해제
    src.delete();
    dst.delete();
    roi.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();

    // 카메라 끄고 결과 화면으로 전환
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    cameraPage.style.display = "none";
    resultPage.style.display = "flex";
  } catch (err) {
    console.error("이미지 처리 오류:", err);
    alert(
      "이미지 처리 중 오류가 발생했습니다. 카메라의 각도를 조금 바꿔 다시 촬영해주세요."
    );
  }
}

// ==========================================
// 5. 좌표 역계산 헬퍼 함수
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
// 6. 결과 화면 동작 함수 (다시찍기, 저장)
// ==========================================
function retakePhoto() {
  resultPage.style.display = "none";
  startCamera();
}

function saveImage() {
  try {
    // TIF 변환을 위해 캔버스 픽셀 데이터 가져오기 (1728x2200)
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // UTIF.js 인코딩 (TIF 바이너리 생성)
    const tiffUint8Array = UTIF.encodeImage(
      imageData.data,
      canvas.width,
      canvas.height
    );
    const blob = new Blob([tiffUint8Array], { type: "image/tiff" });

    // 다운로드 트리거
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

    alert("TIF 파일이 다운로드 되었습니다.");
  } catch (err) {
    console.error("TIF 변환/저장 오류:", err);
    alert("파일 저장에 실패했습니다.");
  }
}

// ==========================================
// 7. 이벤트 리스너 등록
// ==========================================
// 요소가 확실히 존재할 때만 이벤트를 걸어 에러를 방지합니다.
if (startCaptureBtn) startCaptureBtn.addEventListener("click", startCamera);
if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
if (shutterBtn) shutterBtn.addEventListener("click", takePhoto);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
