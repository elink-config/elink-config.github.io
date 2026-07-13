// Extracted from elink-config.github.io/index.html (DLG-CLOCK tool)
// and adapted for the combined da14585-webtool hub.

        function applyImageAdjustments(canvas) {
            const brightness = parseInt(document.getElementById('brightness').value);
            const contrast = parseInt(document.getElementById('contrast').value);
            const saturation = parseInt(document.getElementById('saturation').value);
            const diffusion = parseInt(document.getElementById('diffusion').value) / 100; 
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            if (brightness !== 0) {
                const brightnessFactor = brightness / 100;
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = clamp(data[i] + 255 * brightnessFactor, 0, 255);
                    data[i + 1] = clamp(data[i + 1] + 255 * brightnessFactor, 0, 255);
                    data[i + 2] = clamp(data[i + 2] + 255 * brightnessFactor, 0, 255);
                }
            }
            if (contrast !== 0) {
                const contrastFactor = (contrast + 100) / 100;
                const contrastAdjust = (1 - contrastFactor) * 128;
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = clamp(data[i] * contrastFactor + contrastAdjust, 0, 255);
                    data[i + 1] = clamp(data[i + 1] * contrastFactor + contrastAdjust, 0, 255);
                    data[i + 2] = clamp(data[i + 2] * contrastFactor + contrastAdjust, 0, 255);
                }
            }
            if (saturation !== 100) {
                const saturationFactor = saturation / 100;
                for (let i = 0; i < data.length; i += 4) {
                    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    data[i] = clamp(gray + (data[i] - gray) * saturationFactor, 0, 255);
                    data[i + 1] = clamp(gray + (data[i + 1] - gray) * saturationFactor, 0, 255);
                    data[i + 2] = clamp(gray + (data[i + 2] - gray) * saturationFactor, 0, 255);
                }
            }
            ctx.putImageData(imageData, 0, 0);
            return diffusion;
        }
        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }
        function applyNoneDithering(ctx, width, height, threshold, isColor = false) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const value = gray < threshold ? 0 : 255;
                data[i] = data[i + 1] = data[i + 2] = value;
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyFloydSteinbergDithering(ctx, width, height, threshold, diffusion = 1.0, isColor = false) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const err = (gray - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addError(data, idx + 4, err, 7/16);
                    }
                    if (y + 1 < height) {
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 4 - 4, err, 3/16);
                        }
                        addError(data, idx + width * 4, err, 5/16);
                        if (x + 1 < width) {
                            addError(data, idx + width * 4 + 4, err, 1/16);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyAtkinsonDithering(ctx, width, height, threshold, diffusion = 1.0, isColor = false) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const err = (gray - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addError(data, idx + 4, err, 1/8);
                    }
                    if (x + 2 < width) {
                        addError(data, idx + 8, err, 1/8);
                    }
                    if (y + 1 < height) {
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 4 - 4, err, 1/8);
                        }
                        addError(data, idx + width * 4, err, 1/8);
                        if (x + 1 < width) {
                            addError(data, idx + width * 4 + 4, err, 1/8);
                        }
                    }
                    if (y + 2 < height) {
                        addError(data, idx + width * 8, err, 1/8);
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBayerDithering(ctx, width, height, threshold, diffusion = 1.0, isColor = false) {
            const bayerThresholdMap = [
                [15, 135, 45, 165],
                [195, 75, 225, 105],
                [60, 180, 30, 150],
                [240, 120, 210, 90]
            ];
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const x = (i / 4) % width;
                const y = Math.floor((i / 4) / width);
                const mapValue = bayerThresholdMap[x % 4][y % 4];
                const adjustedThreshold = threshold * (1 + (mapValue - 128) / 128 * diffusion);
                const finalThreshold = clamp(adjustedThreshold, 0, 255);
                const newPixel = gray < finalThreshold ? 0 : 255;
                data[i] = data[i + 1] = data[i + 2] = newPixel;
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyStuckiDithering(ctx, width, height, threshold, diffusion = 1.0, isColor = false) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const err = (gray - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addError(data, idx + 4, err, 8/42);
                    }
                    if (x + 2 < width) {
                        addError(data, idx + 8, err, 4/42);
                    }
                    if (y + 1 < height) {
                        if (x - 2 >= 0) {
                            addError(data, idx + width * 4 - 8, err, 2/42);
                        }
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 4 - 4, err, 4/42);
                        }
                        addError(data, idx + width * 4, err, 8/42);
                        if (x + 1 < width) {
                            addError(data, idx + width * 4 + 4, err, 4/42);
                        }
                        if (x + 2 < width) {
                            addError(data, idx + width * 4 + 8, err, 2/42);
                        }
                    }
                    if (y + 2 < height) {
                        if (x - 2 >= 0) {
                            addError(data, idx + width * 8 - 8, err, 1/42);
                        }
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 8 - 4, err, 2/42);
                        }
                        addError(data, idx + width * 8, err, 4/42);
                        if (x + 1 < width) {
                            addError(data, idx + width * 8 + 4, err, 2/42);
                        }
                        if (x + 2 < width) {
                            addError(data, idx + width * 8 + 8, err, 1/42);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyJarvisJudiceNinkeDithering(ctx, width, height, threshold, diffusion = 1.0, isColor = false) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const err = (gray - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addError(data, idx + 4, err, 7/48);
                    }
                    if (x + 2 < width) {
                        addError(data, idx + 8, err, 5/48);
                    }
                    if (y + 1 < height) {
                        if (x - 2 >= 0) {
                            addError(data, idx + width * 4 - 8, err, 3/48);
                        }
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 4 - 4, err, 5/48);
                        }
                        addError(data, idx + width * 4, err, 7/48);
                        if (x + 1 < width) {
                            addError(data, idx + width * 4 + 4, err, 5/48);
                        }
                        if (x + 2 < width) {
                            addError(data, idx + width * 4 + 8, err, 3/48);
                        }
                    }
                    if (y + 2 < height) {
                        if (x - 2 >= 0) {
                            addError(data, idx + width * 8 - 8, err, 1/48);
                        }
                        if (x - 1 >= 0) {
                            addError(data, idx + width * 8 - 4, err, 3/48);
                        }
                        addError(data, idx + width * 8, err, 5/48);
                        if (x + 1 < width) {
                            addError(data, idx + width * 8 + 4, err, 3/48);
                        }
                        if (x + 2 < width) {
                            addError(data, idx + width * 8 + 8, err, 1/48);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function addError(data, idx, err, factor) {
            data[idx] = clamp(data[idx] + err * factor, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + err * factor, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + err * factor, 0, 255);
        }
        function applyBWRNoneDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (r > g * 1.5 && r > b * 1.5 && r > threshold) {
                    data[i] = 255;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                } else {
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    const value = gray < threshold ? 0 : 255;
                    data[i] = data[i + 1] = data[i + 2] = value;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBWRFloydSteinbergDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    if (oldR > oldG * 1.5 && oldR > oldB * 1.5 && oldR > threshold) {
                        data[idx] = 255;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        continue;
                    }
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const errR = (oldR - newPixel) * diffusion;
                    const errG = (oldG - newPixel) * diffusion;
                    const errB = (oldB - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addColorError(data, idx + 4, errR, errG, errB, 7/16);
                    }
                    if (y + 1 < height) {
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 4 - 4, errR, errG, errB, 3/16);
                        }
                        addColorError(data, idx + width * 4, errR, errG, errB, 5/16);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 4 + 4, errR, errG, errB, 1/16);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBWRAtkinsonDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    if (oldR > oldG * 1.5 && oldR > oldB * 1.5 && oldR > threshold) {
                        data[idx] = 255;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        continue;
                    }
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const errR = (oldR - newPixel) * diffusion;
                    const errG = (oldG - newPixel) * diffusion;
                    const errB = (oldB - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addColorError(data, idx + 4, errR, errG, errB, 1/8);
                    }
                    if (x + 2 < width) {
                        addColorError(data, idx + 8, errR, errG, errB, 1/8);
                    }
                    if (y + 1 < height) {
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 4 - 4, errR, errG, errB, 1/8);
                        }
                        addColorError(data, idx + width * 4, errR, errG, errB, 1/8);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 4 + 4, errR, errG, errB, 1/8);
                        }
                    }
                    if (y + 2 < height) {
                        addColorError(data, idx + width * 8, errR, errG, errB, 1/8);
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBWRBayerDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const bayerThresholdMap = [
                [15, 135, 45, 165],
                [195, 75, 225, 105],
                [60, 180, 30, 150],
                [240, 120, 210, 90]
            ];
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const x = (i / 4) % width;
                const y = Math.floor((i / 4) / width);
                const mapValue = bayerThresholdMap[x % 4][y % 4];
                const adjustedThreshold = threshold * (1 + (mapValue - 128) / 128 * diffusion);
                const finalThreshold = clamp(adjustedThreshold, 0, 255);
                if (r > g * 1.5 && r > b * 1.5 && r > finalThreshold) {
                    data[i] = 255;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                } else {
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    const value = gray < finalThreshold ? 0 : 255;
                    data[i] = data[i + 1] = data[i + 2] = value;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBWRStuckiDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    if (oldR > oldG * 1.5 && oldR > oldB * 1.5 && oldR > threshold) {
                        data[idx] = 255;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        continue;
                    }
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const errR = (oldR - newPixel) * diffusion;
                    const errG = (oldG - newPixel) * diffusion;
                    const errB = (oldB - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addColorError(data, idx + 4, errR, errG, errB, 8/42);
                    }
                    if (x + 2 < width) {
                        addColorError(data, idx + 8, errR, errG, errB, 4/42);
                    }
                    if (y + 1 < height) {
                        if (x - 2 >= 0) {
                            addColorError(data, idx + width * 4 - 8, errR, errG, errB, 2/42);
                        }
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 4 - 4, errR, errG, errB, 4/42);
                        }
                        addColorError(data, idx + width * 4, errR, errG, errB, 8/42);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 4 + 4, errR, errG, errB, 4/42);
                        }
                        if (x + 2 < width) {
                            addColorError(data, idx + width * 4 + 8, errR, errG, errB, 2/42);
                        }
                    }
                    if (y + 2 < height) {
                        if (x - 2 >= 0) {
                            addColorError(data, idx + width * 8 - 8, errR, errG, errB, 1/42);
                        }
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 8 - 4, errR, errG, errB, 2/42);
                        }
                        addColorError(data, idx + width * 8, errR, errG, errB, 4/42);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 8 + 4, errR, errG, errB, 2/42);
                        }
                        if (x + 2 < width) {
                            addColorError(data, idx + width * 8 + 8, errR, errG, errB, 1/42);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function applyBWRJarvisJudiceNinkeDithering(ctx, width, height, threshold, diffusion = 1.0) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const oldR = data[idx];
                    const oldG = data[idx + 1];
                    const oldB = data[idx + 2];
                    if (oldR > oldG * 1.5 && oldR > oldB * 1.5 && oldR > threshold) {
                        data[idx] = 255;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        continue;
                    }
                    const gray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
                    const newPixel = gray < threshold ? 0 : 255;
                    const errR = (oldR - newPixel) * diffusion;
                    const errG = (oldG - newPixel) * diffusion;
                    const errB = (oldB - newPixel) * diffusion;
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    if (x + 1 < width) {
                        addColorError(data, idx + 4, errR, errG, errB, 7/48);
                    }
                    if (x + 2 < width) {
                        addColorError(data, idx + 8, errR, errG, errB, 5/48);
                    }
                    if (y + 1 < height) {
                        if (x - 2 >= 0) {
                            addColorError(data, idx + width * 4 - 8, errR, errG, errB, 3/48);
                        }
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 4 - 4, errR, errG, errB, 5/48);
                        }
                        addColorError(data, idx + width * 4, errR, errG, errB, 7/48);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 4 + 4, errR, errG, errB, 5/48);
                        }
                        if (x + 2 < width) {
                            addColorError(data, idx + width * 4 + 8, errR, errG, errB, 3/48);
                        }
                    }
                    if (y + 2 < height) {
                        if (x - 2 >= 0) {
                            addColorError(data, idx + width * 8 - 8, errR, errG, errB, 1/48);
                        }
                        if (x - 1 >= 0) {
                            addColorError(data, idx + width * 8 - 4, errR, errG, errB, 3/48);
                        }
                        addColorError(data, idx + width * 8, errR, errG, errB, 5/48);
                        if (x + 1 < width) {
                            addColorError(data, idx + width * 8 + 4, errR, errG, errB, 3/48);
                        }
                        if (x + 2 < width) {
                            addColorError(data, idx + width * 8 + 8, errR, errG, errB, 1/48);
                        }
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        function addColorError(data, idx, errR, errG, errB, factor) {
            data[idx] = clamp(data[idx] + errR * factor, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + errG * factor, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + errB * factor, 0, 255);
        }
        const bwrPalette = [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [255, 0, 0, 255]
        ]
        const bwPalette = [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
        ]
        function dithering(ctx, width, height, threshold, type) {
            const diffusion = parseInt(document.getElementById('diffusion').value) / 100;
            if (type.startsWith('bwr_')) {
                const bwrType = type.replace('bwr_', '');
                switch(bwrType) {
                    case 'none':
                        applyBWRNoneDithering(ctx, width, height, threshold, diffusion);
                        break;
                    case 'floydsteinberg':
                        applyBWRFloydSteinbergDithering(ctx, width, height, threshold, diffusion);
                        break;
                    case 'atkinson':
                        applyBWRAtkinsonDithering(ctx, width, height, threshold, diffusion);
                        break;
                    case 'bayer':
                        applyBWRBayerDithering(ctx, width, height, threshold, diffusion);
                        break;
                    case 'stucki':
                        applyBWRStuckiDithering(ctx, width, height, threshold, diffusion);
                        break;
                    case 'jarvis':
                        applyBWRJarvisJudiceNinkeDithering(ctx, width, height, threshold, diffusion);
                        break;
                    default:
                        applyBWRNoneDithering(ctx, width, height, threshold, diffusion);
                }
            } else {
                switch(type) {
                    case 'none':
                        applyNoneDithering(ctx, width, height, threshold, false);
                        break;
                    case 'floydsteinberg':
                        applyFloydSteinbergDithering(ctx, width, height, threshold, diffusion, false);
                        break;
                    case 'atkinson':
                        applyAtkinsonDithering(ctx, width, height, threshold, diffusion, false);
                        break;
                    case 'bayer':
                        applyBayerDithering(ctx, width, height, threshold, diffusion, false);
                        break;
                    case 'stucki':
                        applyStuckiDithering(ctx, width, height, threshold, diffusion, false);
                        break;
                    case 'jarvis':
                        applyJarvisJudiceNinkeDithering(ctx, width, height, threshold, diffusion, false);
                        break;
                    default:
                        applyNoneDithering(ctx, width, height, threshold, false);
                }
            }
        }
        function canvas2bytes(canvas, type = 'bw') {
            const ctx = canvas.getContext("2d");
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const arr = [];
            let buffer = [];
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const index = (canvas.width * 4 * y) + x * 4;
                    if (type !== 'bwr') {
                        buffer.push(imageData.data[index] > 0 && imageData.data[index + 1] > 0 && imageData.data[index + 2] > 0 ? 1 : 0);
                    } else {
                        buffer.push(imageData.data[index] > 0 && imageData.data[index + 1] === 0 && imageData.data[index + 2] === 0 ? 1 : 0);
                    }
                    if (buffer.length === 8) {
                        arr.push(parseInt(buffer.join(''), 2));
                        buffer = [];
                    }
                }
            }
            return arr;
        }

    function canvas2bytes_bw(canvas, type='bw') {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 
  const arr = [];
  let buffer = [];

   
  for (let x =canvas.width-1; x >= 0; x--) {
    for (let y = 0; y < canvas.height; y++) {
      const index = (canvas.width * 4 * y) + x * 4;
      if (type !== 'bwr') {
        buffer.push(imageData.data[index] > 0 && imageData.data[index+1] > 0 && imageData.data[index+2] > 0 ? 1 : 0);
      } else {
        buffer.push(imageData.data[index] > 0 && imageData.data[index+1] === 0 && imageData.data[index+2] === 0 ? 1 : 0);
      }

      if (buffer.length === 8) {
        arr.push(parseInt(buffer.join(''), 2));
        buffer = [];
      }
    }
  }
  return arr;
}
         function canvas2bytes_to(canvas, type = 'bw') {
            const ctx = canvas.getContext("2d");
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const arr = [];
            let buffer = [];
            for (let y = 0; y < canvas.width; y++) {
                for (let x = 0; x < canvas.height; x++) {
                    const index = (canvas.width * 4 * x) + y * 4;
                    if (type !== 'bwr') {
                        buffer.push(imageData.data[index] > 0 && imageData.data[index + 1] > 0 && imageData.data[index + 2] > 0 ? 1 : 0);
                    } else {
                        buffer.push(imageData.data[index] > 0 && imageData.data[index + 1] === 0 && imageData.data[index + 2] === 0 ? 1 : 0);
                    }
                    if (buffer.length === 8) {
                        arr.push(parseInt(buffer.join(''), 2));
                        buffer = [];
                    }
                }
            }
            return arr;
        }
        function getColorDistance(rgba1, rgba2) {
            const [r1, b1, g1] = rgba1;
            const [r2, b2, g2] = rgba2;
            const rm = (r1 + r2) / 2;
            const r = r1 - r2;
            const g = g1 - g2;
            const b = b1 - b2;
            return Math.sqrt((2 + rm / 256) * r * r + 4 * g * g + (2 + (255 - rm) / 256) * b * b);
        }
        function getNearColor(pixel, palette) {
            let minDistance = 255 * 255 * 3 + 1;
            let paletteIndex = 0;
            for (let i = 0; i < palette.length; i++) {
                const targetColor = palette[i];
                const distance = getColorDistance(pixel, targetColor);
                if (distance < minDistance) {
                    minDistance = distance;
                    paletteIndex = i;
                }
            }
            return palette[paletteIndex];
        }
        function getNearColorV2(color, palette) {
            let minDistanceSquared = 255 * 255 + 255 * 255 + 255 * 255 + 1;
            let bestIndex = 0;
            for (let i = 0; i < palette.length; i++) {
                let rdiff = (color[0] & 0xff) - (palette[i][0] & 0xff);
                let gdiff = (color[1] & 0xff) - (palette[i][1] & 0xff);
                let bdiff = (color[2] & 0xff) - (palette[i][2] & 0xff);
                let distanceSquared = rdiff * rdiff + gdiff * gdiff + bdiff * bdiff;
                if (distanceSquared < minDistanceSquared) {
                    minDistanceSquared = distanceSquared;
                    bestIndex = i;
                }
            }
            return palette[bestIndex];
        }
        function updatePixel(imageData, index, color) {
            imageData[index] = color[0];
            imageData[index + 1] = color[1];
            imageData[index + 2] = color[2];
            imageData[index + 3] = color[3];
        }
        function getColorErr(color1, color2, rate) {
            const res = [];
            for (let i = 0; i < 3; i++) {
                res.push(Math.floor((color1[i] - color2[i]) / rate));
            }
            return res;
        }
        function updatePixelErr(imageData, index, err, rate) {
            imageData[index] += err[0] * rate;
            imageData[index + 1] += err[1] * rate;
            imageData[index + 2] += err[2] * rate;
        }
        function ditheringCanvasByPalette(canvas, palette, type) {
            palette = palette || bwrPalette;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const w = imageData.width;
            for (let currentPixel = 0; currentPixel <= imageData.data.length; currentPixel += 4) {
                const newColor = getNearColorV2(imageData.data.slice(currentPixel, currentPixel + 4), palette);
                if (type === "bwr_floydsteinberg") {
                    const err = getColorErr(imageData.data.slice(currentPixel, currentPixel + 4), newColor, 16);
                    updatePixel(imageData.data, currentPixel, newColor);
                    updatePixelErr(imageData.data, currentPixel + 4, err, 7);
                    updatePixelErr(imageData.data, currentPixel + 4 * w - 4, err, 3);
                    updatePixelErr(imageData.data, currentPixel + 4 * w, err, 5);
                    updatePixelErr(imageData.data, currentPixel + 4 * w + 4, err, 1);
                } else {
                    const err = getColorErr(imageData.data.slice(currentPixel, currentPixel + 4), newColor, 8);
                    updatePixel(imageData.data, currentPixel, newColor);
                    updatePixelErr(imageData.data, currentPixel + 4, err, 1);
                    updatePixelErr(imageData.data, currentPixel + 8, err, 1);
                    updatePixelErr(imageData.data, currentPixel + 4 * w - 4, err, 1);
                    updatePixelErr(imageData.data, currentPixel + 4 * w, err, 1);
                    updatePixelErr(imageData.data, currentPixel + 4 * w + 4, err, 1);
                    updatePixelErr(imageData.data, currentPixel + 8 * w, err, 1);
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }

        function hexToBytes(hex) {
            for (var bytes = [], c = 0; c < hex.length; c += 2)
                bytes.push(parseInt(hex.substr(c, 2), 16));
            return new Uint8Array(bytes);
        }
        function bytesToHex(data) {
            return new Uint8Array(data).reduce(
                function (memo, i) {
                    return memo + ("0" + i.toString(16)).slice(-2);
                }, "");
        }
        function intToHex(intIn, bytes = 4) {
            return intIn.toString(16).padStart(bytes * 2, '0');
        }
