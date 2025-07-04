'use client'

import { useState, useEffect } from 'react'
import { 
  Camera, 
  RefreshCw, 
  Loader2, 
  Power, 
  Activity,
  CheckCircle,
  AlertCircle,
  Clock,
  Smartphone,
  WifiOff,
  Plus,
  Minus,
  ZoomIn
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/utils'

interface Account {
  id: string
  tiktok_username: string | null
  geelark_profile_id: string | null
  status: string
  current_setup_step: string | null
  setup_progress: number | null
}

interface Phone {
  id: string
  profile_id: string
  account_id: string
  status: string
  meta: {
    phone_status?: string
    phone_status_updated_at?: string
    battery?: number
  }
  updated_at: string
  account?: Account
}

interface TaskInfo {
  id: string
  type: string
  task_type: string
  status: string
  setup_step?: string
  progress?: number
  started_at?: string
  created_at: string
  meta?: {
    warmup_config?: {
      planned_duration?: number
    }
    duration_minutes?: number
    [key: string]: any
  }
}

interface ScreenshotData {
  accountId: string
  profileId: string
  username: string
  phoneStatus: string
  accountStatus: string
  currentTask?: TaskInfo
  status: 'loading' | 'completed' | 'failed' | 'idle'
  url?: string
  taskId?: string
  lastUpdated?: Date
}

export default function ScreenshotsPage() {
  const [phones, setPhones] = useState<Phone[]>([])
  const [screenshots, setScreenshots] = useState<Record<string, ScreenshotData>>({})
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(7) // Scale from 1 (20%) to 8 (100%)

  // Fetch accounts with phone status
  const fetchPhones = async () => {
    const supabase = createClient()
    
    // Get accounts with geelark profiles
    const { data: accountsData, error: accountsError } = await supabase
      .from('accounts')
      .select(`
        id,
        tiktok_username,
        geelark_profile_id,
        status,
        current_setup_step,
        setup_progress,
        meta,
        updated_at
      `)
      .not('geelark_profile_id', 'is', null)
      .order('updated_at', { ascending: false })

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError)
      return
    }

    if (!accountsData || accountsData.length === 0) {
      setIsLoading(false)
      return
    }

    // Get phone status from phones table for accounts
    const profileIds = accountsData.map(a => a.geelark_profile_id).filter(Boolean)
    const { data: phonesData } = await supabase
      .from('phones')
      .select('profile_id, meta')
      .in('profile_id', profileIds)

    // Create a map of phone statuses
    const phoneStatusMap = new Map<string, any>()
    phonesData?.forEach(phone => {
      phoneStatusMap.set(phone.profile_id, phone.meta)
    })

    // Get active tasks
    const accountIds = accountsData.map(a => a.id)
    const { data: tasksData } = await supabase
      .from('tasks')
      .select(`
        id,
        account_id,
        type,
        task_type,
        status,
        setup_step,
        progress,
        started_at,
        created_at,
        meta
      `)
      .in('account_id', accountIds)
      .in('status', ['running', 'pending'])
      .order('created_at', { ascending: false })

    // Create tasks map
    const tasksMap = new Map<string, TaskInfo[]>()
    tasksData?.forEach(task => {
      if (!tasksMap.has(task.account_id)) {
        tasksMap.set(task.account_id, [])
      }
      tasksMap.get(task.account_id)!.push(task)
    })

    // Create phone-like objects for compatibility
    const phonesWithAccounts = accountsData.map(account => {
      const phoneMeta = phoneStatusMap.get(account.geelark_profile_id!) || {}
      return {
        id: account.id,
        profile_id: account.geelark_profile_id,
        account_id: account.id,
        status: 'unknown',
        meta: phoneMeta,
        updated_at: account.updated_at,
        account: account
      }
    })

    setPhones(phonesWithAccounts)

    // Initialize screenshot data for online phones only
    const initialScreenshots: Record<string, ScreenshotData> = {}
    
    phonesWithAccounts.forEach((phone) => {
      const phoneStatus = phone.meta?.phone_status || 'unknown'
      const isOnline = ['started', 'starting'].includes(phoneStatus)
      
      if (isOnline && phone.account && phone.profile_id) {
        const currentTasks = tasksMap.get(phone.account_id) || []
        const activeTask = currentTasks.find(t => t.status === 'running') || currentTasks[0]
        
        initialScreenshots[phone.profile_id] = {
          accountId: phone.account_id,
          profileId: phone.profile_id,
          username: phone.account.tiktok_username || 'Unnamed',
          phoneStatus,
          accountStatus: phone.account.status,
          currentTask: activeTask,
          status: 'idle'
        }
      }
    })
    
    setScreenshots(initialScreenshots)
    setIsLoading(false)
  }

  // Sync phone status with GeeLark
  const syncPhoneStatus = async () => {
    setIsSyncing(true)
    try {
      const response = await fetch('/api/geelark/sync-phone-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (response.ok) {
        // Refresh data after sync
        await fetchPhones()
      }
    } catch (error) {
      console.error('Failed to sync phone status:', error)
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    fetchPhones()
  }, [])

  // Take screenshot for a specific profile
  const takeScreenshot = async (profileId: string) => {
    setScreenshots(prev => ({
      ...prev,
      [profileId]: { ...prev[profileId], status: 'loading', url: undefined }
    }))

    try {
      // Request screenshot
      const response = await fetch('/api/geelark/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId })
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error)

      const taskId = data.task_id

      // Poll for result
      const pollInterval = setInterval(async () => {
        try {
          const pollResponse = await fetch('/api/geelark/screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId })
          })

          const pollData = await pollResponse.json()
          
          if (pollData.status === 'completed' && pollData.download_url) {
            setScreenshots(prev => ({
              ...prev,
              [profileId]: {
                ...prev[profileId],
                status: 'completed',
                url: pollData.download_url,
                lastUpdated: new Date()
              }
            }))
            clearInterval(pollInterval)
          } else if (pollData.status === 'failed') {
            setScreenshots(prev => ({
              ...prev,
              [profileId]: { ...prev[profileId], status: 'failed' }
            }))
            clearInterval(pollInterval)
          }
        } catch (error) {
          console.error('Polling error:', error)
        }
      }, 2000)

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval)
        setScreenshots(prev => {
          if (prev[profileId]?.status === 'loading') {
            return {
              ...prev,
              [profileId]: { ...prev[profileId], status: 'failed' }
            }
          }
          return prev
        })
      }, 30000)

    } catch (error) {
      setScreenshots(prev => ({
        ...prev,
        [profileId]: { ...prev[profileId], status: 'failed' }
      }))
    }
  }

  // Take screenshots for all online profiles
  const takeAllScreenshots = async () => {
    const onlineProfiles = Object.keys(screenshots)
    
    for (const profileId of onlineProfiles) {
      await takeScreenshot(profileId)
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      takeAllScreenshots()
    }, 30000) // Every 30 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, screenshots])

  // Calculate warmup progress for running tasks
  const calculateWarmupProgress = (task: TaskInfo) => {
    if (task.type !== 'warmup' || task.status !== 'running' || !task.started_at) {
      return 0
    }

    const startTime = new Date(task.started_at).getTime()
    const currentTime = Date.now()
    const elapsedMinutes = (currentTime - startTime) / (1000 * 60)
    
    // Extract planned duration from task meta (same logic as warmup history API)
    let plannedDuration = 30 // Default fallback
    if (task.meta?.warmup_config?.planned_duration) {
      plannedDuration = task.meta.warmup_config.planned_duration
    } else if (task.meta?.duration_minutes) {
      plannedDuration = task.meta.duration_minutes
    }
    
    const progress = Math.min(99, Math.floor((elapsedMinutes / plannedDuration) * 100))
    
    return progress
  }

  // Get activity display text
  const getActivityDisplay = (screenshot: ScreenshotData) => {
    if (screenshot.currentTask) {
      const task = screenshot.currentTask
      
      // Check task type and status
      if (task.task_type === 'sms_login' || task.type === 'login') {
        if (screenshot.accountStatus === 'pending_verification') {
          return { text: 'Awaiting SMS Code', icon: Clock, color: 'text-yellow-600 dark:text-yellow-400' }
        }
        return { text: 'TikTok Login', icon: Activity, color: 'text-blue-600 dark:text-blue-400' }
      } else if (task.type === 'warmup') {
        const progress = calculateWarmupProgress(task)
        return { text: `Warming Up (${progress}%)`, icon: Activity, color: 'text-blue-600 dark:text-blue-400' }
      } else if (task.type === 'post') {
        return { text: 'Posting Content', icon: Activity, color: 'text-blue-600 dark:text-blue-400' }
      } else {
        return { text: `Running ${task.type}`, icon: Activity, color: 'text-blue-600 dark:text-blue-400' }
      }
    }

    // Check account status
    switch (screenshot.accountStatus) {
      case 'active':
        return { text: 'Active - Idle', icon: CheckCircle, color: 'text-green-600 dark:text-green-400' }
      case 'warming_up':
        return { text: 'Warming Up', icon: Activity, color: 'text-blue-600 dark:text-blue-400' }
      case 'paused':
        return { text: 'Paused', icon: Power, color: 'text-gray-600 dark:text-gray-400' }
      case 'banned':
        return { text: 'Banned', icon: AlertCircle, color: 'text-red-600 dark:text-red-400' }
      default:
        return { text: 'Unknown', icon: Clock, color: 'text-gray-600 dark:text-gray-400' }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-dark-400" />
      </div>
    )
  }

  const onlinePhoneCount = Object.keys(screenshots).length

  // Generate scale and grid classes based on zoom level
  const getZoomConfig = () => {
    switch (zoomLevel) {
      case 1: // 20% - Maximum density
        return {
          scale: 'scale-[0.2]',
          gridCols: 'grid-cols-4 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20',
          gap: 'gap-0',
          compact: true,
          percentage: 20
        }
      case 2: // 35% - Very high density
        return {
          scale: 'scale-[0.35]',
          gridCols: 'grid-cols-3 sm:grid-cols-6 md:grid-cols-10 lg:grid-cols-14 xl:grid-cols-16',
          gap: 'gap-0',
          compact: true,
          percentage: 35
        }
      case 3: // 50% - High density
        return {
          scale: 'scale-[0.5]',
          gridCols: 'grid-cols-2 sm:grid-cols-4 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12',
          gap: 'gap-0.5',
          compact: true,
          percentage: 50
        }
      case 4: // 65% - Medium-high density
        return {
          scale: 'scale-[0.65]',
          gridCols: 'grid-cols-1 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
          gap: 'gap-0.5',
          compact: true,
          percentage: 65
        }
      case 5: // 75% - Medium density
        return {
          scale: 'scale-75',
          gridCols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
          gap: 'gap-1',
          compact: true,
          percentage: 75
        }
      case 6: // 85% - Medium-low density
        return {
          scale: 'scale-[0.85]',
          gridCols: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
          gap: 'gap-1',
          compact: false,
          percentage: 85
        }
      case 7: // 100% - Standard size (default)
        return {
          scale: 'scale-100',
          gridCols: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
          gap: 'gap-2',
          compact: false,
          percentage: 100
        }
      case 8: // 100% - Large spacing
        return {
          scale: 'scale-100',
          gridCols: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3',
          gap: 'gap-3',
          compact: false,
          percentage: 100
        }
      default:
        return {
          scale: 'scale-100',
          gridCols: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
          gap: 'gap-2',
          compact: false,
          percentage: 100
        }
    }
  }

  const zoomConfig = getZoomConfig()

  const handleZoomIn = () => {
    if (zoomLevel < 8) setZoomLevel(zoomLevel + 1)
  }

  const handleZoomOut = () => {
    if (zoomLevel > 1) setZoomLevel(zoomLevel - 1)
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Phone Screenshots</h1>
            <p className="page-description">
              Monitor and capture screenshots from online GeeLark phones
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600 dark:text-dark-400">
              <span className="font-medium">{onlinePhoneCount}</span> phones online
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-dark-800 rounded-lg">
              <button
                onClick={handleZoomOut}
                disabled={zoomLevel <= 1}
                className="p-1 rounded text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:text-dark-400 dark:hover:text-dark-100"
                title="Zoom out"
              >
                <Minus className="h-3 w-3" />
              </button>
              
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((level) => (
                  <div
                    key={level}
                    className={`w-1 h-1 rounded-full transition-colors cursor-pointer hover:scale-150 ${
                      level <= zoomLevel
                        ? 'bg-gray-900 dark:bg-dark-100'
                        : 'bg-gray-400 dark:bg-dark-600'
                    }`}
                    onClick={() => setZoomLevel(level)}
                    title={`${getZoomConfig().percentage}%`}
                  />
                ))}
              </div>
              
              <button
                onClick={handleZoomIn}
                disabled={zoomLevel >= 8}
                className="p-1 rounded text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:text-dark-400 dark:hover:text-dark-100"
                title="Zoom in"
              >
                <Plus className="h-3 w-3" />
              </button>

              <span className="text-xs text-gray-600 dark:text-dark-400 ml-1">
                {zoomConfig.percentage}%
              </span>
            </div>

            <button
              onClick={syncPhoneStatus}
              disabled={isSyncing}
              className="btn-secondary"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync Status
            </button>

            <button
              onClick={takeAllScreenshots}
              disabled={onlinePhoneCount === 0}
              className="btn-primary"
            >
              <Camera className="h-4 w-4 mr-2" />
              Capture All ({onlinePhoneCount})
            </button>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-gray-900 focus:ring-gray-900 dark:border-dark-600 dark:bg-dark-700 dark:focus:ring-dark-400"
              />
              <span className="text-sm text-gray-700 dark:text-dark-300">Auto-refresh (30s)</span>
            </label>
          </div>
        </div>
      </div>

      {onlinePhoneCount === 0 ? (
        <div className="card-lg text-center py-12">
          <WifiOff className="h-16 w-16 text-gray-300 dark:text-dark-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-dark-400 mb-4">No phones are currently online</p>
          <button
            onClick={syncPhoneStatus}
            disabled={isSyncing}
            className="btn-secondary mx-auto"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync Phone Status
          </button>
        </div>
      ) : (
        <div className={`grid ${zoomConfig.gridCols} ${zoomConfig.gap}`}>
          {Object.entries(screenshots).map(([profileId, screenshot]) => {
            const activityInfo = getActivityDisplay(screenshot)
            
            return (
              <div
                key={profileId}
                className={`card overflow-hidden group transform transition-transform origin-top-left ${zoomConfig.scale}`}
                style={{ transformOrigin: 'center' }}
              >
                {zoomConfig.compact ? (
                  // Compact header for smaller zoom levels
                  <div className="p-1 border-b border-gray-200 dark:border-dark-700">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-xs text-gray-900 dark:text-dark-100 truncate">
                        {screenshot.username}
                      </h3>
                      <span className={`inline-flex items-center px-1 py-0.5 rounded text-xs font-medium ${
                        screenshot.phoneStatus === 'started' 
                          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>
                        <Power className="h-2 w-2 mr-0.5" />
                        {screenshot.phoneStatus === 'started' ? 'On' : 'Start'}
                      </span>
                    </div>
                    
                    {/* Simplified activity indicator */}
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <activityInfo.icon className={`h-2.5 w-2.5 ${activityInfo.color}`} />
                      <span className={`text-xs ${activityInfo.color} truncate`}>
                        {activityInfo.text}
                      </span>
                    </div>
                  </div>
                ) : (
                  // Full header for larger zoom levels
                  <div className="p-4 border-b border-gray-200 dark:border-dark-700">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 dark:text-dark-100 truncate">
                          {screenshot.username}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-dark-400">
                          {profileId.slice(-8)}
                        </p>
                      </div>
                      <div className="ml-2">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          screenshot.phoneStatus === 'started' 
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>
                          <Power className="h-3 w-3 mr-1" />
                          {screenshot.phoneStatus === 'started' ? 'Online' : 'Starting'}
                        </span>
                      </div>
                    </div>

                    {/* Activity Status */}
                    <div className="flex items-center gap-2">
                      <activityInfo.icon className={`h-4 w-4 ${activityInfo.color}`} />
                      <span className={`text-sm font-medium ${activityInfo.color}`}>
                        {activityInfo.text}
                      </span>
                    </div>

                    {screenshot.lastUpdated && (
                      <p className="text-xs text-gray-500 dark:text-dark-400 mt-2">
                        Updated: {screenshot.lastUpdated.toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                )}

                <div className="relative aspect-[9/16] bg-gray-100 dark:bg-dark-900">
                  {screenshot.status === 'loading' ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400 dark:text-dark-500" />
                    </div>
                  ) : screenshot.status === 'completed' && screenshot.url ? (
                    <img
                      src={screenshot.url}
                      alt={`Screenshot of ${screenshot.username}`}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = ''
                        setScreenshots(prev => ({
                          ...prev,
                          [profileId]: { ...prev[profileId], status: 'failed' }
                        }))
                      }}
                    />
                  ) : screenshot.status === 'failed' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                      <Camera className="h-12 w-12 text-gray-300 dark:text-dark-600 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-dark-400">Failed to capture</p>
                      <button
                        onClick={() => takeScreenshot(profileId)}
                        className="mt-2 text-xs text-gray-600 hover:text-gray-900 dark:text-dark-400 dark:hover:text-dark-200"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                      <Smartphone className="h-12 w-12 text-gray-300 dark:text-dark-600 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-dark-400">No screenshot</p>
                      <button
                        onClick={() => takeScreenshot(profileId)}
                        className="mt-2 text-xs text-gray-600 hover:text-gray-900 dark:text-dark-400 dark:hover:text-dark-200"
                      >
                        Capture Now
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => takeScreenshot(profileId)}
                    disabled={screenshot.status === 'loading'}
                    className="absolute bottom-2 right-2 p-2 bg-black bg-opacity-50 rounded-lg text-white hover:bg-opacity-70 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    title="Refresh screenshot"
                  >
                    <RefreshCw className={`h-4 w-4 ${screenshot.status === 'loading' ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}