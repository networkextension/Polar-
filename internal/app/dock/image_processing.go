package dock

import (
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

const (
	postImageSmallMaxDimension  = 480
	postImageMediumMaxDimension = 1280
)

type processedImageVariant struct {
	URL  string
	Path string
}

func processUploadedPostImage(uploadDir, originalPath, originalURL, originalFilename string) (PostImage, []string, error) {
	file, err := os.Open(originalPath)
	if err != nil {
		return PostImage{}, nil, err
	}
	defer file.Close()

	src, format, err := image.Decode(file)
	if err != nil {
		return PostImage{
			OriginalURL: originalURL,
			MediumURL:   originalURL,
			SmallURL:    originalURL,
		}, nil, fmt.Errorf("decode image failed: %w", err)
	}

	ext := imageOutputExt(format)
	medium, err := writeResizedVariant(uploadDir, originalFilename, "md", ext, src, postImageMediumMaxDimension)
	if err != nil {
		return PostImage{}, nil, err
	}
	small, err := writeResizedVariant(uploadDir, originalFilename, "sm", ext, src, postImageSmallMaxDimension)
	if err != nil {
		return PostImage{}, cleanupGeneratedImagePaths(medium.Path), err
	}

	imageItem := PostImage{
		OriginalURL: originalURL,
		MediumURL:   originalURL,
		SmallURL:    originalURL,
	}
	savedPaths := make([]string, 0, 2)
	if medium.URL != "" {
		imageItem.MediumURL = medium.URL
		savedPaths = append(savedPaths, medium.Path)
	}
	if small.URL != "" {
		imageItem.SmallURL = small.URL
		savedPaths = append(savedPaths, small.Path)
	}
	return imageItem, savedPaths, nil
}

func writeResizedVariant(uploadDir, originalFilename, suffix, ext string, src image.Image, maxDimension int) (processedImageVariant, error) {
	if maxDimension <= 0 {
		return processedImageVariant{}, nil
	}

	resized, changed := resizeToFit(src, maxDimension)
	if !changed {
		return processedImageVariant{}, nil
	}

	filename := buildDerivedUploadFilename(originalFilename, suffix, ext)
	path := filepath.Join(uploadDir, filename)
	if err := writeImageFile(path, resized, ext); err != nil {
		return processedImageVariant{}, err
	}

	return processedImageVariant{
		URL:  "/uploads/" + filename,
		Path: path,
	}, nil
}

func resizeToFit(src image.Image, maxDimension int) (image.Image, bool) {
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return src, false
	}

	longest := width
	if height > longest {
		longest = height
	}
	if longest <= maxDimension {
		return src, false
	}

	if width >= height {
		return resizeImageNearest(src, maxDimension, max(1, height*maxDimension/width)), true
	}
	return resizeImageNearest(src, max(1, width*maxDimension/height), maxDimension), true
}

func resizeImageNearest(src image.Image, targetWidth, targetHeight int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	srcBounds := src.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()

	for y := 0; y < targetHeight; y++ {
		srcY := srcBounds.Min.Y + y*srcHeight/targetHeight
		for x := 0; x < targetWidth; x++ {
			srcX := srcBounds.Min.X + x*srcWidth/targetWidth
			dst.Set(x, y, opaqueColor(src.At(srcX, srcY)))
		}
	}
	return dst
}

func opaqueColor(c color.Color) color.Color {
	r, g, b, a := c.RGBA()
	if a == 0 || a == 0xffff {
		return c
	}
	r = r * 0xffff / a
	g = g * 0xffff / a
	b = b * 0xffff / a
	return color.RGBA64{R: uint16(r), G: uint16(g), B: uint16(b), A: 0xffff}
}

func writeImageFile(path string, img image.Image, ext string) error {
	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()

	switch strings.ToLower(ext) {
	case ".png":
		return png.Encode(out, img)
	case ".gif":
		return gif.Encode(out, img, nil)
	default:
		return jpeg.Encode(out, img, &jpeg.Options{Quality: 82})
	}
}

func imageOutputExt(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "png":
		return ".png"
	case "gif":
		return ".gif"
	default:
		return ".jpg"
	}
}

func cleanupGeneratedImagePaths(paths ...string) []string {
	cleaned := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) != "" {
			cleaned = append(cleaned, path)
		}
	}
	return cleaned
}
