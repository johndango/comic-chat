import type { DecodedBitmap } from "./avb";

export interface PanelScene {
  backdrop: DecodedBitmap;
  character: DecodedBitmap;
  characterName: string;
  message: string;
}

const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 600;

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
    canvas.width = LOGICAL_WIDTH * scale;
    canvas.height = LOGICAL_HEIGHT * scale;
    context.scale(scale, scale);
  }

  render(scene: PanelScene): void {
    const context = this.context;
    context.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const background = bitmapCanvas(scene.backdrop);
    const backgroundScale = Math.max(
      LOGICAL_WIDTH / scene.backdrop.width,
      LOGICAL_HEIGHT / scene.backdrop.height,
    );
    const backgroundWidth = scene.backdrop.width * backgroundScale;
    const backgroundHeight = scene.backdrop.height * backgroundScale;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      background,
      (LOGICAL_WIDTH - backgroundWidth) / 2,
      (LOGICAL_HEIGHT - backgroundHeight) / 2,
      backgroundWidth,
      backgroundHeight,
    );

    const character = bitmapCanvas(scene.character);
    const characterHeight = Math.min(430, scene.character.height * 3.25);
    const characterScale = characterHeight / scene.character.height;
    const characterWidth = scene.character.width * characterScale;
    const characterX = 96;
    const characterY = LOGICAL_HEIGHT - characterHeight - 26;
    context.drawImage(character, characterX, characterY, characterWidth, characterHeight);

    context.font = "700 30px 'Trebuchet MS', sans-serif";
    const lines = wrapText(context, scene.message, 440);
    const bubbleX = 405;
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
    context.moveTo(bubbleX + 95, bubbleY + bubbleHeight - 3);
    context.lineTo(bubbleX + 22, bubbleY + bubbleHeight + 88);
    context.lineTo(bubbleX + 152, bubbleY + bubbleHeight - 2);
    context.closePath();
    context.fillStyle = "#fffdf5";
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = "#11161c";
    context.stroke();
    context.beginPath();
    context.moveTo(bubbleX + 88, bubbleY + bubbleHeight);
    context.lineTo(bubbleX + 156, bubbleY + bubbleHeight);
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
    roundedRect(context, 34, 32, labelWidth, 43, 8);
    context.fillStyle = "#ffd43b";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "#11161c";
    context.stroke();
    context.fillStyle = "#11161c";
    context.textBaseline = "middle";
    context.fillText(scene.characterName.toUpperCase(), 51, 54);
    context.restore();

    context.lineWidth = 12;
    context.strokeStyle = "#11161c";
    context.strokeRect(6, 6, LOGICAL_WIDTH - 12, LOGICAL_HEIGHT - 12);
  }
}
