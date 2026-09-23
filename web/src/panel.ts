import type { DecodedBitmap } from "./avb";

export interface PanelScene {
  backdrop: DecodedBitmap;
  character: DecodedBitmap;
  characterName: string;
  characterSide: "left" | "right";
  emotionLabel: string;
  message: string;
  panelNumber: number;
}

export const PANEL_WIDTH = 960;
export const PANEL_HEIGHT = 600;

function bitmapCanvas(bitmap: DecodedBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(bitmap.pixels), bitmap.width, bitmap.height),
    0,
    0,
  );
  return canvas;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.trim().split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines.slice(0, 5) : ["Say something…"];
}

export class PanelRenderer {
  readonly context: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    this.context = context;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PANEL_WIDTH * scale;
    canvas.height = PANEL_HEIGHT * scale;
    context.scale(scale, scale);
  }

  render(scene: PanelScene): void {
    const context = this.context;
    context.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);

    const background = bitmapCanvas(scene.backdrop);
    const backgroundScale = Math.max(
      PANEL_WIDTH / scene.backdrop.width,
      PANEL_HEIGHT / scene.backdrop.height,
    );
    const backgroundWidth = scene.backdrop.width * backgroundScale;
    const backgroundHeight = scene.backdrop.height * backgroundScale;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      background,
      (PANEL_WIDTH - backgroundWidth) / 2,
      (PANEL_HEIGHT - backgroundHeight) / 2,
      backgroundWidth,
      backgroundHeight,
    );

    const character = bitmapCanvas(scene.character);
    const characterHeight = Math.min(430, scene.character.height * 3.25);
    const characterScale = characterHeight / scene.character.height;
    const characterWidth = scene.character.width * characterScale;
    const characterX = scene.characterSide === "left" ? 96 : PANEL_WIDTH - characterWidth - 96;
    const characterY = PANEL_HEIGHT - characterHeight - 26;
    context.drawImage(character, characterX, characterY, characterWidth, characterHeight);

    context.font = "700 30px 'Trebuchet MS', sans-serif";
    const lines = wrapText(context, scene.message, 440);
    const bubbleX = scene.characterSide === "left" ? 405 : 55;
    const bubbleY = 78;
    const bubbleWidth = 500;
    const bubbleHeight = Math.max(154, 76 + lines.length * 39);

    context.save();
    context.shadowColor = "rgba(17, 22, 28, 0.28)";
    context.shadowBlur = 0;
    context.shadowOffsetX = 8;
    context.shadowOffsetY = 9;
    roundedRect(context, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 35);
    context.fillStyle = "#fffdf5";
    context.fill();
    context.shadowColor = "transparent";
    context.lineWidth = 5;
    context.strokeStyle = "#11161c";
    context.stroke();

    context.beginPath();
    const tailBaseOne = scene.characterSide === "left" ? bubbleX + 95 : bubbleX + bubbleWidth - 95;
    const tailTip = scene.characterSide === "left" ? bubbleX + 22 : bubbleX + bubbleWidth - 22;
    const tailBaseTwo = scene.characterSide === "left" ? bubbleX + 152 : bubbleX + bubbleWidth - 152;
    context.moveTo(tailBaseOne, bubbleY + bubbleHeight - 3);
    context.lineTo(tailTip, bubbleY + bubbleHeight + 88);
    context.lineTo(tailBaseTwo, bubbleY + bubbleHeight - 2);
    context.closePath();
    context.fillStyle = "#fffdf5";
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = "#11161c";
    context.stroke();
    context.beginPath();
    context.moveTo(Math.min(tailBaseOne, tailBaseTwo) - 7, bubbleY + bubbleHeight);
    context.lineTo(Math.max(tailBaseOne, tailBaseTwo) + 4, bubbleY + bubbleHeight);
    context.strokeStyle = "#fffdf5";
    context.lineWidth = 8;
    context.stroke();

    context.fillStyle = "#11161c";
    context.textBaseline = "top";
    lines.forEach((line, index) => {
      context.fillText(line, bubbleX + 30, bubbleY + 34 + index * 39);
    });
    context.restore();

    context.save();
    context.font = "800 20px 'Trebuchet MS', sans-serif";
    const labelWidth = context.measureText(scene.characterName.toUpperCase()).width + 34;
    const labelX = scene.characterSide === "left" ? 34 : PANEL_WIDTH - labelWidth - 34;
    roundedRect(context, labelX, 32, labelWidth, 43, 8);
    context.fillStyle = "#ffd43b";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "#11161c";
    context.stroke();
    context.fillStyle = "#11161c";
    context.textBaseline = "middle";
    context.fillText(scene.characterName.toUpperCase(), labelX + 17, 54);
    context.restore();

    context.save();
    context.font = "700 15px ui-monospace, monospace";
    const emotionText = `AUTO: ${scene.emotionLabel.toUpperCase()}`;
    const emotionWidth = context.measureText(emotionText).width + 24;
    const emotionX = scene.characterSide === "left" ? PANEL_WIDTH - emotionWidth - 27 : 27;
    roundedRect(context, emotionX, PANEL_HEIGHT - 55, emotionWidth, 30, 5);
    context.fillStyle = "rgba(255, 253, 245, 0.92)";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#11161c";
    context.stroke();
    context.fillStyle = "#11161c";
    context.textBaseline = "middle";
    context.fillText(emotionText, emotionX + 12, PANEL_HEIGHT - 40);
    context.restore();

    context.save();
    context.font = "900 18px 'Trebuchet MS', sans-serif";
    context.fillStyle = "#11161c";
    context.fillText(`#${String(scene.panelNumber).padStart(2, "0")}`, 20, PANEL_HEIGHT - 20);
    context.restore();

    context.lineWidth = 12;
    context.strokeStyle = "#11161c";
    context.strokeRect(6, 6, PANEL_WIDTH - 12, PANEL_HEIGHT - 12);
  }
}
