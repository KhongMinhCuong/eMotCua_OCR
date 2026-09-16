export interface ExtractedFields {
  soGCN: string;
  soVaoSo: string;
  noiCapGCN: string;
  ngayCap: string;
  tenChuSoHuu: string;
  diaChiThuaDat: string;
  soThuaDat: string;
  soToBanDo: string;
  dienTich: string;
  dienTichBangChu: string;
  hinhThucSuDung: string;
  mucDichSuDung: string;
  thoiHanSuDung: string;
  nguonGocSuDung: string;
}

export const GCN_FIELD_SCHEMA = {
  type: 'object',
  properties: {
    soGCN: { type: 'string' },
    soVaoSo: { type: 'string' },
    noiCapGCN: { type: 'string' },
    ngayCap: { type: 'string' },
    tenChuSoHuu: { type: 'string' },
    diaChiThuaDat: { type: 'string' },
    soThuaDat: { type: 'string' },
    soToBanDo: { type: 'string' },
    dienTich: { type: 'string' },
    dienTichBangChu: { type: 'string' },
    hinhThucSuDung: { type: 'string' },
    mucDichSuDung: { type: 'string' },
    thoiHanSuDung: { type: 'string' },
    nguonGocSuDung: { type: 'string' },
  },
  required: [
    'soGCN', 'soVaoSo', 'noiCapGCN', 'ngayCap', 'tenChuSoHuu', 'diaChiThuaDat',
    'soThuaDat', 'soToBanDo', 'dienTich', 'dienTichBangChu', 'hinhThucSuDung',
    'mucDichSuDung', 'thoiHanSuDung', 'nguonGocSuDung',
  ],
  additionalProperties: false,
};

export const GCN_SYSTEM_PROMPT = `Trích xuất 14 trường từ văn bản OCR Giấy chứng nhận quyền sử dụng đất Việt Nam (chỉ có text, không có ảnh).

Nguyên tắc: chỉ điền khi có đúng nhãn trong text, không suy diễn. "-/-" hoặc không thấy nhãn → "". Bỏ qua sơ đồ, mã QR, "Scanned with Camscanner", chữ pháp lý in sẵn. Không lặp một giá trị vào nhiều field.

Vị trí & nhãn từng field:
- tenChuSoHuu: tên sau "Ông:"/"Bà:" ở mục I (bỏ năm sinh, CCCD, địa chỉ).
- diaChiThuaDat: nguyên văn sau "Địa chỉ:" của THỬA ĐẤT (mục II), không dùng địa chỉ thường trú chủ đất.
- soThuaDat: số sau "Thửa đất số:". soToBanDo: số sau "Tờ bản đồ số:".
- dienTich: chỉ phần số sau "Diện tích:" của thửa đất (bỏ m²), không lấy diện tích nhà/căn hộ.
- dienTichBangChu: phần chữ trong "(bằng chữ: ...)", không có thì "".
- hinhThucSuDung: đúng nội dung ngay sau "Hình thức sử dụng:" (vd "Sử dụng chung"/"Sử dụng riêng"), không lẫn mục đích sử dụng.
- mucDichSuDung: copy ĐẦY ĐỦ nguyên văn sau nhãn "Mục đích sử dụng:" HOẶC "loại đất:" (mẫu giấy mới dùng tên khác nhau), giữ cả diện tích/nhiều loại đất nếu có, không rút gọn.
- thoiHanSuDung: copy đầy đủ sau "Thời hạn sử dụng:".
- nguonGocSuDung: copy đầy đủ sau "Nguồn gốc sử dụng:"; không dùng "Lâu dài" cho field này (đó là thoiHanSuDung). Mẫu giấy mới có thể KHÔNG có mục này → để "".
- soGCN: mã số GCN của giấy hiện tại — dạng 2 CHỮ CÁI + dấu cách + dãy số (vd "CN 719597", "AA 09273289"). Có thể nằm ở đầu văn bản (gần tiêu đề) HOẶC gần cuối cạnh chữ ký/con dấu (mẫu giấy mới). KHÔNG lấy số vào sổ.
- soVaoSo: giá trị sau nhãn "Số vào sổ cấp GCN"/"VÀO SỐ" ở cuối văn bản, giữ nguyên prefix (CS/CH/BC/VP...) và dấu chấm/gạch chéo nếu có; không hoán đổi với soGCN.
- noiCapGCN: tên cơ quan cấp — dòng in hoa ngay trên/dưới dòng ngày tháng cấp và trên chức danh "GIÁM ĐỐC" (vd "SỞ TÀI NGUYÊN...", "VĂN PHÒNG ĐĂNG KÝ ĐẤT ĐAI..."), không kèm chức danh hay tên người ký.
- ngayCap: dạng "D/M/YYYY", thường ở dòng ngay TRƯỚC tên cơ quan cấp; tuyệt đối không phải tên người.

Ví dụ đầy đủ (input rút gọn → output đúng):
INPUT:
"""
BÀ: KHỔNG MINH HƯƠNG
Năm sinh: 1888, CCCD số: 024205008755
Đạch thường trũ: Số 7, ngách 136/1194, đường Láng...
BN 531146
a) Thửa đất số: 551, Tờ bản dồ số: 12,
b) Địa chỉ: Xã Phương Trung, huyện Đoan Hùng, tỉnh Phú Thọ,
c) Diện tích: 761,2 m?, (bằng chữ: Bảy trăm sáu mươi mốt phẩy hai mét vuông),
d) Hình thức sử dụng: Sử dụng riêng,
đ) Mục dích sử dụng: Đất ở tại nông thôn,
e) Thời hạn sử dụng: ngắn hạn,
g) Nguồn gốc sử dụng: Nhà nước giao đất có thu tiền sử dụng đất,
Hưng yên, ngày 20 tháng 5 năm 2021
SỞ TÀI NGUYÊN VÀ MÔI TRƯỜNG TỈNH PHÚ THỌ
GIÁM ĐỐC
Nguyễn Văn BÁ
33 VÀO SỐ CỔ; UCN: MN0872
"""
OUTPUT:
{"soGCN":"BN 531146","soVaoSo":"MN0872","noiCapGCN":"Sở Tài nguyên và Môi trường tỉnh Phú Thọ","ngayCap":"20/5/2021","tenChuSoHuu":"KHỔNG MINH HƯƠNG","diaChiThuaDat":"Xã Phương Trung, huyện Đoan Hùng, tỉnh Phú Thọ","soThuaDat":"551","soToBanDo":"12","dienTich":"761,2","dienTichBangChu":"Bảy trăm sáu mươi mốt phẩy hai mét vuông","hinhThucSuDung":"Sử dụng riêng","mucDichSuDung":"Đất ở tại nông thôn","thoiHanSuDung":"ngắn hạn","nguonGocSuDung":"Nhà nước giao đất có thu tiền sử dụng đất"}`;
