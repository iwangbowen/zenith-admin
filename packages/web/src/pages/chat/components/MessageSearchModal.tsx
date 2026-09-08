import { Button, Empty, Input, Select, Tag, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { MessageSquare, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { formatConvTime } from '@/utils/date';
import type { ChatMessage, ChatMessageSearchItem } from '@zenith/shared/chat';
import { CHAT_MESSAGE_TYPE_OPTIONS } from '../types';
import type { SearchDatePreset, Setter } from '../types';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';

const { Text } = Typography;

/** 聊天记录搜索弹窗：关键词/类型/发送人/时间筛选 + 结果跳转（自 ChatPage 原样搬移） */
export function MessageSearchModal({
  showSearchPanel, setShowSearchPanel, resetSearchFilters, searchHasSearched, searchTotal, msgSearch,
  setMsgSearch, executeSearch, searchTypeFilters, setSearchTypeFilters, searchSenderId, setSearchSenderId,
  senderOptions, searchDatePreset, applyDatePreset, searchTimeRange, setSearchTimeRange, searchLoading,
  searchResults, searchPage, jumpToSearchResult, setSearchDatePreset,
}: Readonly<{
  showSearchPanel: boolean;
  setShowSearchPanel: Setter<boolean>;
  resetSearchFilters: () => void;
  searchHasSearched: boolean;
  searchTotal: number;
  msgSearch: string;
  setMsgSearch: Setter<string>;
  executeSearch: (page?: number) => Promise<void>;
  searchTypeFilters: ChatMessage['type'][];
  setSearchTypeFilters: Setter<ChatMessage['type'][]>;
  searchSenderId: number | undefined;
  setSearchSenderId: Setter<number | undefined>;
  senderOptions: Array<{ value: number; label: string }>;
  searchDatePreset: SearchDatePreset;
  setSearchDatePreset: Setter<SearchDatePreset>;
  applyDatePreset: (preset: SearchDatePreset) => void;
  searchTimeRange: [Date, Date] | null;
  setSearchTimeRange: Setter<[Date, Date] | null>;
  searchLoading: boolean;
  searchResults: ChatMessageSearchItem[];
  searchPage: number;
  jumpToSearchResult: (item: ChatMessageSearchItem) => Promise<void>;
}>) {
  return (
      <AppModal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={16} style={{ color: 'var(--semi-color-text-2)' }} />
            <span>聊天记录</span>
            <Text type="tertiary" style={{ fontSize: 12, marginLeft: 'auto' }}>{searchHasSearched ? `共 ${searchTotal} 条` : '未搜索'}</Text>
          </div>
        }
        visible={showSearchPanel}
        onCancel={resetSearchFilters}
        footer={null}
        width={900}
        bodyStyle={{ padding: 0, maxHeight: '80vh' }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', height: '100%', maxHeight: '80vh' }}>
          {/* 左列：搜索条件 */}
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <Input
              size="small"
              prefix={<Search size={13} />}
              placeholder="搜索消息内容 / 文件名 / 发送人"
              value={msgSearch}
              onChange={setMsgSearch}
              onEnterPress={() => { void executeSearch(1); }}
              showClear
            />

            <Select
              multiple
              showClear
              style={{ width: '100%' }}
              placeholder="消息类别（可多选）"
              value={searchTypeFilters}
              onChange={(val) => setSearchTypeFilters(((val as ChatMessage['type'][]) ?? []))}
              optionList={CHAT_MESSAGE_TYPE_OPTIONS}
              maxTagCount={2}
            />

            <FilterSelect
              placeholder="全部发送人"
              items={senderOptions}
              value={searchSenderId}
              onChange={setSearchSenderId}
              width="100%"
              filter
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { value: 'today', label: '今天' },
                { value: '7d', label: '近7天' },
                { value: '30d', label: '近30天' },
              ].map((item) => (
                <Button
                  key={item.value}
                  size="small"
                  theme={searchDatePreset === item.value ? 'solid' : 'borderless'}
                  type={searchDatePreset === item.value ? 'primary' : 'tertiary'}
                  onClick={() => applyDatePreset(item.value as SearchDatePreset)}
                >
                  {item.label}
                </Button>
              ))}
              {searchTimeRange && (
                <Button size="small" theme="borderless" type="tertiary" onClick={() => applyDatePreset('')}>清空时间</Button>
              )}
            </div>

            <DateRangeFilter
              value={searchTimeRange}
              onChange={(range) => {
                setSearchDatePreset('');
                setSearchTimeRange(range);
              }}
              width="100%"
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <SearchButton onClick={() => { void executeSearch(1); }} loading={searchLoading} />
              <ResetButton onClick={resetSearchFilters} />
            </div>
          </div>

          {/* 右列：搜索结果 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
            {!searchHasSearched && (
              <Empty description="输入关键词或设置筛选条件后开始搜索" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
            )}
            {searchHasSearched && searchResults.length === 0 && !searchLoading && (
              <Empty description="没有找到符合条件的消息" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
            )}
            <SemiList
              split={false}
              dataSource={searchResults}
              renderItem={(item) => {
                const typeLabel = CHAT_MESSAGE_TYPE_OPTIONS.find((option) => option.value === item.message.type)?.label ?? item.message.type;
                return (
                  <SemiList.Item
                    key={item.message.id}
                    style={{ padding: 0, marginBottom: 10, border: 'none' }}
                  >
                    <div
                      style={{
                        width: '100%', textAlign: 'left', border: '1px solid var(--semi-color-border)', background: 'var(--surface-card)', borderRadius: 'var(--semi-border-radius-medium)',
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Tag size="small" color="light-blue">{typeLabel}</Tag>
                          <Text strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.message.senderName ?? '未知发送人'}
                          </Text>
                        </div>
                        <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(item.message.createdAt)}</Text>
                      </div>
                      <Text style={{ display: 'block', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {item.snippet}
                      </Text>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            setShowSearchPanel(false);
                            void jumpToSearchResult(item);
                          }}
                        >
                          定位到聊天位置
                        </Button>
                      </div>
                    </div>
                  </SemiList.Item>
                );
              }}
            />

            {searchHasSearched && searchResults.length < searchTotal && (
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <Button
                  size="small"
                  type="tertiary"
                  theme="borderless"
                  loading={searchLoading}
                  onClick={() => { void executeSearch(searchPage + 1); }}
                >
                  加载更多结果
                </Button>
              </div>
            )}
          </div>
        </div>
      </AppModal>
  );
}
