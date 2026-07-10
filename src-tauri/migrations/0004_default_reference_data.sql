-- HomeLedger schema v1: default categories and a non-sensitive cash payment method.

INSERT INTO categories(id, name, type, parent_id, icon, color, sort_order, is_default, is_active, created_at, updated_at) VALUES
    ('10000000-0000-7000-8000-000000000001', '饮食', 'expense', NULL, 'utensils', '#F05A14', 10, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000002', '住房', 'expense', NULL, 'house', '#1976D2', 20, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000003', '教育', 'expense', NULL, 'graduation-cap', '#7455D9', 30, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000004', '交通', 'expense', NULL, 'car-front', '#087F7A', 40, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000005', '购物', 'expense', NULL, 'shopping-bag', '#B66A00', 50, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000006', '医疗', 'expense', NULL, 'stethoscope', '#D9364F', 60, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000007', '娱乐', 'expense', NULL, 'clapperboard', '#6D48C7', 70, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000008', '旅行', 'expense', NULL, 'luggage', '#7455D9', 80, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000009', '保险', 'expense', NULL, 'shield-check', '#087F7A', 90, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000010', '礼物', 'expense', NULL, 'gift', '#D9364F', 100, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000011', '税费', 'expense', NULL, 'receipt-text', '#B66A00', 110, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000012', '其他', 'expense', NULL, 'ellipsis', '#667085', 120, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000101', '超市', 'expense', '10000000-0000-7000-8000-000000000001', 'shopping-cart', '#F05A14', 10, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000102', '餐厅', 'expense', '10000000-0000-7000-8000-000000000001', 'utensils', '#F05A14', 20, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000103', '外卖', 'expense', '10000000-0000-7000-8000-000000000001', 'bike', '#F05A14', 30, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000104', '咖啡', 'expense', '10000000-0000-7000-8000-000000000001', 'coffee', '#F05A14', 40, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000201', '房租', 'expense', '10000000-0000-7000-8000-000000000002', 'key-round', '#1976D2', 10, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000202', '房贷', 'expense', '10000000-0000-7000-8000-000000000002', 'landmark', '#1976D2', 20, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000203', '地税', 'expense', '10000000-0000-7000-8000-000000000002', 'building-2', '#1976D2', 30, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000204', '水电', 'expense', '10000000-0000-7000-8000-000000000002', 'plug-zap', '#1976D2', 40, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000205', '网络', 'expense', '10000000-0000-7000-8000-000000000002', 'wifi', '#1976D2', 50, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000206', '家庭维修', 'expense', '10000000-0000-7000-8000-000000000002', 'hammer', '#1976D2', 60, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000301', '工资', 'income', NULL, 'briefcase-business', '#12843B', 10, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000302', '奖金', 'income', NULL, 'badge-dollar-sign', '#12843B', 20, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000303', '奖学金', 'income', NULL, 'graduation-cap', '#12843B', 30, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000304', '退款', 'income', NULL, 'rotate-ccw', '#12843B', 40, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000305', '投资收入', 'income', NULL, 'chart-no-axes-combined', '#12843B', 50, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000306', '房租收入', 'income', NULL, 'house-plus', '#12843B', 60, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000307', '政府补助', 'income', NULL, 'landmark', '#12843B', 70, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000308', '礼金', 'income', NULL, 'gift', '#12843B', 80, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('10000000-0000-7000-8000-000000000309', '其他收入', 'income', NULL, 'ellipsis', '#12843B', 90, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO payment_methods(
    id, display_name, method_type, institution, last_four, default_currency_code,
    icon, color, is_active, created_at, updated_at
) VALUES (
    '20000000-0000-7000-8000-000000000001', '现金', 'cash', NULL, NULL, 'CAD',
    'banknote', '#087F7A', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
