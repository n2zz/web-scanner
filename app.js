// DOM 요소 가져오기
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");

let stream = null; // 카메라 스트림 저장용 변수

// 1. 카메라 시작 함수
async function startCamera() {
  try {
    // 화면 전환: 랜딩 숨김 -> 카메라 보임
    landingPage.style.display = "none";
    cameraPage.style.display = "flex"; // flex로 해야 중앙정렬 스타일 먹힘

    const constraints = {
      video: {
        facingMode: "environment", // 후면 카메라
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    console.log("카메라 시작됨");
  } catch (err) {
    console.error("카메라 오류:", err);
    alert("카메라 권한이 필요합니다. 설정에서 권한을 허용해주세요.");
    closeCamera(); // 실패 시 다시 랜딩으로
  }
}

// 2. 카메라 끄기 및 초기화 함수 (취소 버튼용)
function closeCamera() {
  // 스트림 정지
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  video.srcObject = null;

  // 화면 전환: 카메라 숨김 -> 랜딩 보임
  cameraPage.style.display = "none";
  landingPage.style.display = "block"; // 원래대로 복귀
}

// 3. 사진 촬영 함수 (셔터 버튼용)
function takePhoto() {
  if (!stream) return;

  // 비디오 크기에 맞춰 캔버스 설정
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");

  // 현재 프레임 그리기
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // (효과) 찰칵 소리 대신 화면 깜빡임 효과 등 추가 가능
  alert("촬영 완료! (다음 단계에서 결과 확인)");

  // TODO: 여기서 촬영된 이미지를 가지고 다음 단계(자르기/보정)로 이동하는 로직 필요
  // closeCamera();
}

// 이벤트 리스너 연결
startCaptureBtn.addEventListener("click", startCamera);
closeCameraBtn.addEventListener("click", closeCamera);
shutterBtn.addEventListener("click", takePhoto);
