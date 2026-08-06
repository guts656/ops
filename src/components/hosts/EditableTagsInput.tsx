import { Input, Select, Tag } from 'antd'
import type { SelectProps } from 'antd'
import { useMemo, useState } from 'react'

interface Props {
  value?: string[]
  onChange?: (value: string[]) => void
  options: string[]
  placeholder?: string
}

function normalize(value: string) {
  return value.trim()
}

export default function EditableTagsInput({ value = [], onChange, options, placeholder = '输入标签后回车' }: Props) {
  const [editingTag, setEditingTag] = useState<string>()
  const [editingValue, setEditingValue] = useState('')
  const optionItems = useMemo(() => options.map((item) => ({ label: item, value: item })), [options])

  function update(next: string[]) {
    onChange?.(Array.from(new Set(next.map(normalize).filter(Boolean))))
  }

  function finishEdit(originalValue: string) {
    const tag = normalize(editingValue)
    const next = tag ? value.map((item) => (item === originalValue ? tag : item)) : value.filter((item) => item !== originalValue)
    update(next)
    setEditingTag(undefined)
    setEditingValue('')
  }

  const tagRender: SelectProps<string[]>['tagRender'] = ({ label, value: tagValue, closable, onClose }) => {
    const text = String(tagValue)
    if (editingTag === text) {
      return (
        <Input
          size="small"
          autoFocus
          value={editingValue}
          style={{ width: Math.max(96, editingValue.length * 12), height: 24, marginInlineEnd: 4 }}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setEditingValue(event.target.value)}
          onPressEnter={() => finishEdit(text)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditingTag(undefined)
              setEditingValue('')
            }
          }}
          onBlur={() => finishEdit(text)}
        />
      )
    }
    return (
      <Tag
        closable={closable}
        onClose={onClose}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setEditingTag(text)
          setEditingValue(text)
        }}
        style={{ cursor: 'text', marginInlineEnd: 4 }}
        title="点击编辑标签"
      >
        {label}
      </Tag>
    )
  }

  return (
    <Select
      mode="tags"
      value={value}
      options={optionItems}
      placeholder={placeholder}
      tagRender={tagRender}
      onChange={(next) => update(next)}
    />
  )
}
