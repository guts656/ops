import { Component } from 'react'
import { Button, Result, Typography } from 'antd'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('页面渲染异常', error, errorInfo)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <Result
        status="500"
        title="页面渲染异常"
        subTitle="当前页面组件发生错误，平台没有崩溃。你可以刷新页面或返回首页继续使用。"
        extra={[
          <Button type="primary" key="reload" onClick={() => window.location.reload()}>
            刷新页面
          </Button>,
          <Button key="home" onClick={() => { window.location.href = '/' }}>
            返回首页
          </Button>,
        ]}
      >
        {import.meta.env.DEV && (
          <Typography.Paragraph type="secondary" copyable>
            {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
          </Typography.Paragraph>
        )}
      </Result>
    )
  }
}
