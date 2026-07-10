import { Card, Empty } from 'antd'
import * as echarts from 'echarts'
import { useEffect, useRef } from 'react'
import type { HostResourcePoint } from '../../types/host'

interface Props {
  data: HostResourcePoint[]
}

export default function HostResourceTrend({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current || !data.length) return undefined

    const chart = echarts.init(chartRef.current)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { top: 8, data: ['CPU', '内存', '磁盘'], textStyle: { color: '#dbe7ff' } },
      grid: { left: 48, right: 28, top: 64, bottom: 72, containLabel: true },
      xAxis: { type: 'category', data: data.map((item) => item.time), axisLabel: { color: '#9fb1d9', interval: 'auto', rotate: 35, margin: 16 } },
      yAxis: { type: 'value', max: 100, axisLabel: { color: '#9fb1d9', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#27304f' } } },
      series: [
        { name: 'CPU', type: 'line', smooth: true, data: data.map((item) => item.cpu), lineStyle: { color: '#1677ff', width: 3 }, itemStyle: { color: '#1677ff' } },
        { name: '内存', type: 'line', smooth: true, data: data.map((item) => item.memory), lineStyle: { color: '#52c41a', width: 3 }, itemStyle: { color: '#52c41a' } },
        { name: '磁盘', type: 'line', smooth: true, data: data.map((item) => item.disk), lineStyle: { color: '#faad14', width: 3 }, itemStyle: { color: '#faad14' } },
      ],
    })

    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [data])

  return (
    <Card title="近 24 小时资源使用趋势">
      {data.length ? <div ref={chartRef} style={{ height: 340 }} /> : <Empty description="暂无 Agent 指标上报" />}
    </Card>
  )
}
