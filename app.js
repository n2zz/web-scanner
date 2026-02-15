// DOM 요소 가져오기
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const resultPage = document.getElementById("result-page");
const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const scannedImage = document.getElementById("scannedImage");
const guideBox = document.querySelector(".camera-guide-box"); // 가이드 박스 요소

const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const retakeBtn = document.getElementById("retakeBtn");
const saveBtn = document.getElementById("saveBtn"); // 저장 버튼

let stream = null;
let isOpenCvReady = false;

// 0. OpenCV 로드 확인
function onOpenCvReady() {
  isOpenCvReady = true;
  console.log("OpenCV.js 로드 완료!");
}

// 1. 카메라 시작
async function startCamera() {
  if (!isOpenCvReady) {
    alert("엔진 로딩 중입니다. 잠시만 기다려주세요.");
    return;
  }
  try {
    landingPage.style.display = "none";
    cameraPage.style.display = "flex";

    // 가능한 고해상도(4K/FHD) 요청
    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 1728 }, // 4K 시도
        height: { ideal: 2200 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    // 비디오가 실제로 로드된 후 메타데이터 확인 (해상도 등)
    video.onloadedmetadata = () => {
      console.log(`카메라 해상도: ${video.videoWidth}x${video.videoHeight}`);
    };
  } catch (err) {
    console.error("카메라 오류:", err);
    alert("카메라 권한을 확인해주세요.");
    closeCamera();
  }
}

// 2. 카메라 종료
function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraPage.style.display = "none";
  landingPage.style.display = "block";
}

// ★ 3. 고해상도 촬영 및 평탄화 (핵심) ★
// ★ 3. 고해상도 촬영 및 1728x2200 평탄화 ★
function takePhoto() {
  if (!stream) return;

  try {
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;
    canvas.width = vWidth;
    canvas.height = vHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, vWidth, vHeight);

    let src = cv.imread(canvas);
    let dst = new cv.Mat();

    // [수정됨] 1. 최적 이미지 사이즈 1728 x 2200 적용
    let dsize = new cv.Size(1728, 2200);

    const rect = getCropCoordinates(video, guideBox);

    let x = Math.max(0, rect.x);
    let y = Math.max(0, rect.y);
    let w = Math.min(vWidth - x, rect.w);
    let h = Math.min(vHeight - y, rect.h);

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

    // 변환된 이미지를 숨겨진 캔버스에 그리기 (크기가 1728x2200으로 맞춰짐)
    cv.imshow(canvas, dst);

    // 화면 미리보기용 (브라우저는 TIF를 img 태그로 직접 보여주지 못하므로 미리보기는 고품질 JPEG 사용)
    scannedImage.src = canvas.toDataURL("image/jpeg", 1.0);

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
    console.error("이미지 처리 오류:", err);
    alert("이미지 처리에 실패했습니다.");
  }
}

// ★ 4. TIF 파일 변환 및 다운로드 (새로 작성됨) ★
function saveImage() {
  try {
    // 1. 숨겨진 캔버스(1728x2200)에서 픽셀 데이터 추출
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 2. UTIF.js를 사용하여 TIF 바이너리 데이터로 인코딩
    const tiffUint8Array = UTIF.encodeImage(
      imageData.data,
      canvas.width,
      canvas.height
    );

    // 3. 바이너리 데이터를 Blob(파일 객체)으로 변환
    const blob = new Blob([tiffUint8Array], { type: "image/tiff" });

    // 4. 다운로드 링크 생성 및 클릭 유도
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14);
    link.download = `scan_${timestamp}.tif`; // 확장자 tif 지정
    link.href = url;

    document.body.appendChild(link);
    link.click();

    // 메모리 정리
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    alert("TIF 파일 다운로드가 완료되었습니다.");
  } catch (err) {
    console.error("TIF 변환 오류:", err);
    alert("파일 다운로드 중 오류가 발생했습니다.");
  }
}

// ★ 화면의 가이드 박스를 실제 비디오 좌표로 변환하는 헬퍼 함수 ★
function getCropCoordinates(videoElem, guideBoxElem) {
  const videoRatio = videoElem.videoWidth / videoElem.videoHeight;
  const screenRatio = videoElem.clientWidth / videoElem.clientHeight;

  // 가이드 박스의 화면상 위치
  const guideRect = guideBoxElem.getBoundingClientRect();
  const videoRect = videoElem.getBoundingClientRect();

  let scale;
  let offsetX = 0;
  let offsetY = 0;

  // object-fit: cover 로직 역계산
  if (screenRatio > videoRatio) {
    // 화면이 비디오보다 더 납작함 -> 비디오의 위아래가 잘림 (또는 가로가 꽉 참)
    // 실제로는 모바일 세로모드라 반대인 경우가 많음
    scale = videoElem.videoWidth / videoElem.clientWidth;
    offsetY = (videoElem.videoHeight - videoElem.clientHeight * scale) / 2;
  } else {
    // 화면이 비디오보다 더 길쭉함 (모바일 세로) -> 비디오의 좌우가 잘림
    scale = videoElem.videoHeight / videoElem.clientHeight;
    offsetX = (videoElem.videoWidth - videoElem.clientWidth * scale) / 2;
  }

  // 실제 비디오 상의 좌표 계산
  // (가이드박스 절대위치 - 비디오 절대위치) * 스케일 + 오프셋
  let realX = (guideRect.left - videoRect.left) * scale + offsetX;
  let realY = (guideRect.top - videoRect.top) * scale + offsetY;
  let realW = guideRect.width * scale;
  let realH = guideRect.height * scale;

  return { x: realX, y: realY, w: realW, h: realH };
}

function retakePhoto() {
  resultPage.style.display = "none";
  startCamera();
}

// 이벤트 리스너
startCaptureBtn.addEventListener("click", startCamera);
closeCameraBtn.addEventListener("click", closeCamera);
shutterBtn.addEventListener("click", takePhoto);
retakeBtn.addEventListener("click", retakePhoto);
saveBtn.addEventListener("click", saveImage);
