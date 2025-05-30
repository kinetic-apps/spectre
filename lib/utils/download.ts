/**
 * Force download a file from a URL
 * This utility fetches the file and creates a blob to ensure download instead of browser preview
 */
export async function forceDownload(url: string, filename: string): Promise<void> {
  try {
    // Fetch the file
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`)
    }
    
    // Get the blob
    const blob = await response.blob()
    
    // Create a temporary URL for the blob
    const blobUrl = window.URL.createObjectURL(blob)
    
    // Create a temporary anchor element and trigger download
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    link.style.display = 'none'
    
    // Append to body, click, and remove
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // Clean up the blob URL after a short delay
    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl)
    }, 100)
  } catch (error) {
    console.error('Download failed:', error)
    // Fallback to simple download
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
  }
}

/**
 * Download multiple files with a delay between each to prevent browser blocking
 */
export async function downloadMultipleFiles(
  files: Array<{ url: string; filename: string }>,
  delayMs: number = 200
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    await forceDownload(files[i].url, files[i].filename)
    
    // Add delay between downloads (except for the last one)
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

export async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // Clean up
    window.URL.revokeObjectURL(downloadUrl)
  } catch (error) {
    console.error('Error downloading file:', error)
    throw error
  }
}

export async function downloadFilesAsZip(
  files: { url: string; filename: string }[],
  zipFilename: string
) {
  try {
    // Dynamic import JSZip to avoid loading it unless needed
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    
    // Download all files and add to zip
    const downloadPromises = files.map(async (file) => {
      try {
        const response = await fetch(file.url)
        const blob = await response.blob()
        zip.file(file.filename, blob)
      } catch (error) {
        console.error(`Error downloading ${file.filename}:`, error)
      }
    })
    
    await Promise.all(downloadPromises)
    
    // Generate zip file
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const downloadUrl = window.URL.createObjectURL(zipBlob)
    
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = zipFilename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // Clean up
    window.URL.revokeObjectURL(downloadUrl)
  } catch (error) {
    console.error('Error creating zip file:', error)
    throw error
  }
} 