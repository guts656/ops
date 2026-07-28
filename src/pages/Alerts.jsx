import { Card, Flex, Modal, Spin, Tabs, Typography, message } from 'antd'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import AlertList from '../components/AlertList'
import AlertDetailDrawer from '../components/alerts/AlertDetailDrawer'
import AlertFilters from '../components/alerts/AlertFilters'
import AlertNoisePanel from '../components/alerts/AlertNoisePanel'
import AlertSummaryCards from '../components/alerts/AlertSummaryCards'
import { useAlertStore } from '../stores/alertStore'
import { getRealtimeSocket } from '../utils/realtime'

function filtersFromSearchParams(searchParams) {
  const filters = { includeSuppressed: false }
  const textKeys = ['service', 'status', 'level', 'source', 'keyword']
  for (const key of textKeys) {
    const value = searchParams.get(key)
    if (value) filters[key] = value
  }
  const active = searchParams.get('active')
  if (active === 'true') filters.active = true
  if (active === 'false') filters.active = false
  const includeSuppressed = searchParams.get('includeSuppressed')
  if (includeSuppressed === 'true') filters.includeSuppressed = true
  return filters
}

export default function Alerts() {
  const [searchParams] = useSearchParams()
  const {
    alerts,
    filters,
    pagination,
    summary,
    noiseStats,
    suppressedAlerts,
    loading,
    noiseLoading,
    load,
    loadSummary,
    loadNoiseStats,
    loadSuppressedAlerts,
    setFilters,
    changePage,
    diagnose,
    diagnosis,
    diagnosingId,
    acknowledge,
    resolve,
    selectedAlert,
    detailOpen,
    openDetail,
    closeDetail,
    suppressFingerprint,
    unsuppressFingerprint,
  } = useAlertStore()

  useEffect(() => {
    const initialFilters = filtersFromSearchParams(searchParams)
    const store = useAlertStore.getState()
    void Promise.all([store.load({ ...initialFilters, page: 1 }), store.refreshOverview(), store.loadSuppressedAlerts()])
    const socket = getRealtimeSocket()
    const refresh = () => {
      const current = useAlertStore.getState()
      void Promise.all([current.load(), current.refreshOverview()])
    }
    socket?.emit('alert:subscribe')
    socket?.on('alert:new', refresh)
    socket?.on('alert:updated', refresh)
    socket?.on('alert:resolved', refresh)
    return () => {
      socket?.off('alert:new', refresh)
      socket?.off('alert:updated', refresh)
      socket?.off('alert:resolved', refresh)
    }
  }, [searchParams])

  const handleSuppress = async (input) => {
    await suppressFingerprint(input)
    message.success('已抑制该类告警')
  }

  const handleUnsuppress = async (fingerprint) => {
    await unsuppressFingerprint(fingerprint)
    message.success('已恢复该类告警')
  }

  return (
    <Flex vertical gap="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3}>告警中心</Typography.Title>
        <Typography.Paragraph type="secondary">
          集中处理平台告警，支持告警确认、解决、AI 辅助诊断，并引入指纹去重和降噪抑制能力。
        </Typography.Paragraph>
      </Card>

      <AlertSummaryCards summary={summary} noiseStats={noiseStats} />

      <Tabs
        items={[
          {
            key: 'list',
            label: '告警列表',
            children: (
              <Flex vertical gap="middle">
                <AlertFilters filters={filters} loading={loading} onChange={setFilters} onSearch={() => load()} />
                <Card title="告警列表" extra={<Typography.Text type="secondary">默认隐藏已抑制告警</Typography.Text>}>
                  <Spin spinning={loading}>
                    <AlertList
                      alerts={alerts}
                      showActions
                      diagnosingId={diagnosingId}
                      onDiagnose={diagnose}
                      onAcknowledge={acknowledge}
                      onResolve={resolve}
                      onDetail={openDetail}
                      pagination={pagination}
                      onPageChange={changePage}
                    />
                  </Spin>
                </Card>
              </Flex>
            ),
          },
          {
            key: 'noise',
            label: '降噪管理',
            children: (
              <AlertNoisePanel
                stats={noiseStats}
                records={suppressedAlerts}
                loading={noiseLoading}
                onRefresh={async () => {
                  await Promise.all([loadNoiseStats(), loadSuppressedAlerts(), loadSummary()])
                }}
                onSuppress={handleSuppress}
                onUnsuppress={handleUnsuppress}
              />
            ),
          },
        ]}
      />

      <AlertDetailDrawer alert={selectedAlert} open={detailOpen} onClose={closeDetail} />
      <Modal
        title="AI 诊断结果"
        open={Boolean(diagnosis)}
        onCancel={() => useAlertStore.setState({ diagnosis: null })}
        footer={null}
      >
        <Typography.Paragraph>{diagnosis?.result}</Typography.Paragraph>
      </Modal>
    </Flex>
  )
}
