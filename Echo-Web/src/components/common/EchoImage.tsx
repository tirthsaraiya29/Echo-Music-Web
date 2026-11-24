import { useState, useEffect } from 'react'
import { artwork } from '../../utils/artwork.ts'
import { recordArtworkMetric, type EchoImageProps } from '../../services/artwork/artworkTypes.ts'

export function EchoImage({
  src,
  alt = '',
  seed = 'echo-artwork',
  size = 240,
  className,
  decorative = false,
}: EchoImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string>(() => src || artwork(seed, size))
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (src) {
      setCurrentSrc(src)
      setHasError(false)
    } else {
      recordArtworkMetric('artworkGenerated')
      setCurrentSrc(artwork(seed, size))
    }
  }, [src, seed, size])

  const handleError = () => {
    if (!hasError) {
      setHasError(true)
      recordArtworkMetric('imageLoadErrors')
      recordArtworkMetric('imageFallbacksTriggered')
      setCurrentSrc(artwork(seed, size))
    }
  }

  const handleLoad = () => {
    recordArtworkMetric('imagesLoaded')
  }

  return (
    <img
      src={currentSrc}
      alt={decorative ? '' : alt}
      aria-hidden={decorative ? 'true' : undefined}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
      onLoad={handleLoad}
      className={className}
    />
  )
}
