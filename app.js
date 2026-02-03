// DOM 요소 가져오기
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const resultPage = document.getElementById("result-page"); // 추가
const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const scannedImage = document.getElementById("scannedImage"); // 추가

const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const retakeBtn = document.getElementById("retakeBtn"); // 추가
const uploadBtn = document.getElementById("uploadBtn"); // 추가

let stream = null;
let isOpenCvReady = false;

// 0. OpenCV 로드 확인 함수 (HTML에서 호출)
function onOpenCvReady() {
  isOpenCvReady = true;
  console.log("OpenCV.js 로드 완료!");
}

// 1. 카메라 시작 함수
async function startCamera() {
  if (!isOpenCvReady) {
    alert("이미지 처리 엔진을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    landingPage.style.display = "none";
    cameraPage.style.display = "flex";

    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
  } catch (err) {
    console.error("카메라 오류:", err);
    alert("카메라 권한이 필요합니다.");
    closeCamera();
  }
}

// 2. 카메라 끄기
function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraPage.style.display = "none";
  landingPage.style.display = "block";
}

// 3. ★ 핵심: 사진 촬영 및 OpenCV 이미지 처리 ★
function takePhoto() {
  if (!stream) return;

  // 1단계: 비디오 화면을 캔버스에 그리기 (원본)
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2단계: OpenCV로 이미지 처리 (팩스 효과)
  try {
    // 캔버스에서 이미지 데이터 가져오기
    let src = cv.imread(canvas);
    let dst = new cv.Mat();

    // 1. 그레이스케일(흑백) 변환
    cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);

    // 2. Adaptive Thresholding (조명 편차 제거 및 선명화)
    // 그림자 진 곳도 글자만 남기고 흰색으로 날려버리는 고급 이진화 기술
    cv.adaptiveThreshold(
      src,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21,
      10
    );

    // 3단계: 처리된 이미지를 캔버스에 다시 그리기
    cv.imshow(canvas, dst);

    // 메모리 해제
    src.delete();
    dst.delete();

    // 4단계: 화면 전환 (카메라 끄고 결과창 보이기)
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    // 캔버스 이미지를 img 태그로 전달
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.8);

    cameraPage.style.display = "none";
    resultPage.style.display = "flex";
  } catch (err) {
    console.error("OpenCV 처리 오류:", err);
    alert("이미지 처리 중 오류가 발생했습니다.");
  }
}

// 4. 다시 찍기 (결과창에서 카메라로 복귀)
function retakePhoto() {
  resultPage.style.display = "none";
  startCamera(); // 카메라 다시 켜기
}

// 5. 서버 전송 (임시)
function uploadData() {
  alert("다음 스텝: TIFF 변환 및 서버 업로드 개발 예정");
}

// 이벤트 리스너
startCaptureBtn.addEventListener("click", startCamera);
closeCameraBtn.addEventListener("click", closeCamera);
shutterBtn.addEventListener("click", takePhoto);
retakeBtn.addEventListener("click", retakePhoto);
uploadBtn.addEventListener("click", uploadData);
