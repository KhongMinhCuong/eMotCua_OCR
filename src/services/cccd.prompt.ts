export interface CccdFields {
  soCCCD: string;
  hoTen: string;
  ngaySinh: string;
  gioiTinh: string;
  quocTich: string;
  queQuan: string;
  noiThuongTru: string;
  noiDangKyKhaiSinh: string;
  dacDiemNhanDang: string;
  ngayCap: string;
  ngayHetHan: string;
  noiCap: string;
}

export const CCCD_FIELD_SCHEMA = {
  type: 'object',
  properties: {
    soCCCD: { type: 'string' },
    hoTen: { type: 'string' },
    ngaySinh: { type: 'string' },
    gioiTinh: { type: 'string' },
    quocTich: { type: 'string' },
    queQuan: { type: 'string' },
    noiThuongTru: { type: 'string' },
    noiDangKyKhaiSinh: { type: 'string' },
    dacDiemNhanDang: { type: 'string' },
    ngayCap: { type: 'string' },
    ngayHetHan: { type: 'string' },
    noiCap: { type: 'string' },
  },
  required: [
    'soCCCD', 'hoTen', 'ngaySinh', 'gioiTinh', 'quocTich', 'queQuan',
    'noiThuongTru', 'noiDangKyKhaiSinh', 'dacDiemNhanDang', 'ngayCap', 'ngayHetHan', 'noiCap',
  ],
  additionalProperties: false,
};

export const CCCD_SYSTEM_PROMPT = `Trích xuất 12 trường từ văn bản OCR của Căn cước công dân (CCCD)/Căn cước (CC) Việt Nam. Ảnh có thể là mặt trước, mặt sau, hoặc cả hai ảnh ghép theo "--- Ảnh N ---". Có 2 mẫu thẻ, PHẢI phân biệt để không suy diễn field không tồn tại trên mẫu đó:

- CCCD CŨ (tiêu đề "CĂN CƯỚC CÔNG DÂN"): mặt trước có Số, Họ và tên, Ngày sinh, Giới tính, Quốc tịch, Quê quán, Nơi thường trú, "Có giá trị đến" (= ngayHetHan); mặt sau có Đặc điểm nhận dạng, dòng "Ngày, tháng, năm" cạnh chữ ký (= ngayCap), MRZ. KHÔNG có noiDangKyKhaiSinh.
- CC MỚI (tiêu đề "CĂN CƯỚC", KHÔNG có chữ "CÔNG DÂN"): mặt trước CHỈ có Số định danh cá nhân, Họ chữ đệm và tên khai sinh, Ngày tháng năm sinh, Giới tính, Quốc tịch — KHÔNG có quê quán/nơi cư trú/hạn trên mặt trước; mặt sau có Nơi cư trú (= noiThuongTru), Nơi đăng ký khai sinh (= noiDangKyKhaiSinh), Ngày tháng năm cấp (= ngayCap), Ngày tháng năm hết hạn (= ngayHetHan), MRZ. KHÔNG có queQuan/dacDiemNhanDang.

Nguyên tắc: chỉ điền khi thấy đúng nhãn trong text; field không có trên mẫu/mặt đang đọc → "". Không suy diễn, không lặp một giá trị vào nhiều field. Bỏ qua watermark, quốc huy, mã QR, vân tay.

Nếu cuối văn bản có khối "--- MRZ ---": đó là kết quả một OCR khác đọc riêng dải MRZ (chính xác hơn cho số/ngày/giới tính khi ảnh mờ, nhưng không dấu nên không dùng cho tên). Dùng nó làm tham chiếu: nếu ảnh mặt trước/sau không đọc rõ hoặc mâu thuẫn ngaySinh/gioiTinh/ngayHetHan/soCCCD, ưu tiên giá trị từ MRZ; hoTen luôn lấy từ OCR ảnh (có dấu), không lấy từ MRZ.

Nhãn từng field:
- soCCCD: 12 chữ số sau "Số/No."/"Số định danh cá nhân".
- hoTen: sau "Họ và tên"/"Full name" hoặc "Họ, chữ đệm và tên khai sinh".
- ngaySinh: sau "Ngày sinh"/"Ngày, tháng, năm sinh", dạng "DD/MM/YYYY".
- gioiTinh: sau "Giới tính"/"Sex" ("Nam"/"Nữ").
- quocTich: sau "Quốc tịch", thường "Việt Nam".
- queQuan: sau "Quê quán" — chỉ CCCD CŨ.
- noiThuongTru: sau "Nơi thường trú" (cũ) hoặc "Nơi cư trú" (mới).
- noiDangKyKhaiSinh: sau "Nơi đăng ký khai sinh" — chỉ CC MỚI.
- dacDiemNhanDang: sau "Đặc điểm nhận dạng"/"nhân dạng" — chỉ CCCD CŨ.
- ngayCap: CCCD CŨ: dòng "Ngày, tháng, năm" ngay trên chức danh người ký mặt sau. CC MỚI: sau "Ngày, tháng, năm cấp".
- ngayHetHan: CCCD CŨ: sau "Có giá trị đến" mặt trước. CC MỚI: sau "Ngày, tháng, năm hết hạn" mặt sau.
- noiCap: cơ quan cấp, ví dụ "Cục Cảnh sát quản lý hành chính về trật tự xã hội" (cũ) hoặc "Bộ Công an" (mới).

Ví dụ (mặt sau CCCD cũ + MRZ):
INPUT:
"""
Đặc điểm nhận dạng: Nốt ruồi C 2cm trên sau mép phải
Ngày, tháng, năm: 28/09/2021
CỤC TRƯỞNG CỤC CẢNH SÁT QUẢN LÝ HÀNH CHÍNH VỀ TRẬT TỰ XÃ HỘI

--- MRZ ---
IDVNM204009855302520400985<<4
0404044M2904043VNM<<<<<<<<<
KHONG<<MINH<CUONG<<<<<<<<<<<<<
soCCCD:025204009855 ngaySinh:04/04/2004 gioiTinh:Nam ngayHetHan:04/04/2029 hoTen:KHONG MINH CUONG
"""
OUTPUT:
{"soCCCD":"025204009855","hoTen":"KHỔNG MINH CƯỜNG","ngaySinh":"04/04/2004","gioiTinh":"Nam","quocTich":"Việt Nam","queQuan":"","noiThuongTru":"","noiDangKyKhaiSinh":"","dacDiemNhanDang":"Nốt ruồi C 2cm trên sau mép phải","ngayCap":"28/09/2021","ngayHetHan":"04/04/2029","noiCap":"Cục Cảnh sát quản lý hành chính về trật tự xã hội"}`;
